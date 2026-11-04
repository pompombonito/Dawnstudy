import copy
import json
import unittest
from unittest.mock import Mock, patch
from io import BytesIO
from docx import Document
from fastapi.testclient import TestClient
from questionnaire import QuestionnaireError, parse_questionnaire, convert_questionnaire, validate_completion, docx_questionnaire_text
from test_generation_limits import main, InlineExecutor
from generation_jobs import GenerationJobs, GenerationCancelled
from live_games import correct_answer


CHOICES = """Biology questionnaire
1. Which organelle releases usable energy?
A. Nucleus
B. Mitochondrion
C. Ribosome
D. Cell membrane
2. Which is a product of photosynthesis?
A. Oxygen
B. Nitrogen
C. Helium
D. Sodium
Answer key:
1. B  2. A
"""
IDENTIFICATION = "1. Identify the organelle that releases usable energy.\nAnswer: Mitochondrion"


class ParserTests(unittest.TestCase):
    def test_docx_tables_and_list_numbering_are_not_lost(self):
        document = Document()
        document.add_paragraph("Name the unit.", style="List Number")
        document.add_paragraph("Answer: Joule")
        table = document.add_table(rows=2, cols=2)
        table.cell(0, 0).text = "Question"
        table.cell(0, 1).text = "Answer"
        table.cell(1, 0).text = "Name the force."
        table.cell(1, 1).text = "Gravity"
        records = parse_questionnaire([docx_questionnaire_text(document)])
        self.assertEqual([item["answer"] for item in records], ["Joule", "Gravity"])
        self.assertEqual(records[1]["question"], "Name the force.")

    def test_inline_answer_is_preserved_and_game_grading_keeps_punctuation(self):
        record = parse_questionnaire(["1. Name the language. Answer: C++"])[0]
        self.assertEqual(record["question"], "Name the language.")
        self.assertEqual(record["answer"], "C++")
        card = convert_questionnaire([record], "identification", {})[0]
        self.assertTrue(correct_answer(card, "identification", "C++"))
        self.assertFalse(correct_answer(card, "identification", "C#"))

    def test_choice_text_order_and_keys_are_preserved(self):
        records = parse_questionnaire([CHOICES])
        items = convert_questionnaire(records, "multiple_choice", {})
        self.assertEqual(items[0]["options"], ["Nucleus", "Mitochondrion", "Ribosome", "Cell membrane"])
        self.assertEqual(items[0]["answer"], "Mitochondrion")
        self.assertEqual(items[1]["answer"], "Oxygen")
        self.assertTrue(items[0]["imported"])

    def test_choices_removed_for_flashcards_and_identification(self):
        for kind in ("flashcards", "identification"):
            items = convert_questionnaire(parse_questionnaire([CHOICES]), kind, {})
            self.assertEqual(items[0]["question"], "Which organelle releases usable energy?")
            self.assertEqual(items[0]["answer"], "Mitochondrion")
            self.assertNotIn("options", items[0])
            self.assertNotIn("correct_answer", items[0])

    def test_inline_choices_and_labeled_answer(self):
        records = parse_questionnaire(["1) Color of grass? A) Green B) Blue C) Red\nAnswer: A) Green"])
        self.assertEqual(records[0]["options"], ["Green", "Blue", "Red"])
        self.assertEqual(records[0]["question"], "Color of grass?")
        self.assertEqual(records[0]["answer"], "Green")

    def test_same_line_key_letter_answers_and_blank_answer_fields(self):
        records = parse_questionnaire(["1. Name the vitamin. A. C B. A C. B Answer: B"])
        self.assertEqual(records[0]["answer"], "A")
        self.assertEqual(records[0]["options"], ["C", "A", "B"])
        self.assertEqual(parse_questionnaire(["1. Name the unit.\nAnswer: _____"])[0]["answer"], "")

    def test_qa_blocks_unicode_and_multiline_preserved(self):
        records = parse_questionnaire(["Q: Définir le terme ‘énergie’.\nUse SI units.\nA: Joule\nQ: Name the symbol.\nA: J"])
        self.assertEqual(records[0]["question"], "Définir le terme ‘énergie’.\nUse SI units.")
        self.assertEqual(records[1]["answer"], "J")

    def test_separate_answer_key_and_page_markers(self):
        records = parse_questionnaire(["[SOURCE: quiz.pdf · PDF page 1]\n1. Name the force.\n[SOURCE: quiz.pdf · PDF page 2]\n2. Name the unit.", "[SOURCE: key.txt · Document]\nAnswer key\n1: Gravity\n2: Newton"])
        self.assertEqual([item["answer"] for item in records], ["Gravity", "Newton"])
        self.assertEqual(records[0]["source_refs"], ["quiz.pdf · PDF page 1"])

    def test_missing_or_conflicting_keys_and_layout_are_not_guessed(self):
        for document in (
            CHOICES.replace("1. B  2. A", "1. Z  2. A"),
            CHOICES.replace("2. Which", "1. Which"),
            CHOICES.replace("B. Mitochondrion", "C. Mitochondrion"),
            CHOICES + "3. D\n",
            CHOICES.replace("Answer key:", "Answer: B\nAnswer key:"),
            "No numbered questions in these lecture notes.",
            "1. Which?\nA. Same\nB. Same\nAnswer: A",
        ):
            with self.subTest(document=document), self.assertRaises(QuestionnaireError):
                parse_questionnaire([document])

    def test_no_silent_truncation_at_200(self):
        text = "\n".join(f"{n}. Question {n}?\nAnswer: Answer {n}" for n in range(1, 202))
        with self.assertRaisesRegex(QuestionnaireError, "more than 200"):
            parse_questionnaire([text])
        self.assertEqual(len(parse_questionnaire([text], 201)), 201)

    def test_ai_cannot_rewrite_supplied_answers_or_questions(self):
        records = parse_questionnaire([IDENTIFICATION])
        valid = {"items": [{"number": "1", "question": records[0]["question"], "answer": "Mitochondrion", "uncertain": False, "distractors": ["Nucleus", "Ribosome", "Chloroplast"]}]}
        for field, value in (("answer", "Nucleus"), ("question", "Rephrased?"), ("number", "2"), ("uncertain", True), ("uncertain", "false"), ("distractors", ["Nucleus", "Nucleus", "Chloroplast"]), ("distractors", ["mitochondrion", "Nucleus", "Ribosome"])):
            invalid = copy.deepcopy(valid)
            invalid["items"][0][field] = value
            with self.subTest(field=field, value=value), self.assertRaises(QuestionnaireError):
                validate_completion(records, invalid, True)
        complete = validate_completion(records, valid, True)
        item = convert_questionnaire(records, "multiple_choice", complete)[0]
        self.assertEqual(item["question"], records[0]["question"])
        self.assertEqual(item["answer_origin"], "provided")
        self.assertEqual(len(item["options"]), 4)
        self.assertIn("Choices added by AI", item["explanation"])


class ImportRouteTests(unittest.TestCase):
    def setUp(self):
        self.user = {"user_id": "gmail-student", "email": "student@gmail.com"}
        main.app.dependency_overrides[main.onboarded_user] = lambda: self.user
        main.app.dependency_overrides[main.authenticated_user] = lambda: self.user
        self.addCleanup(main.app.dependency_overrides.clear)
        self.client = TestClient(main.app)
        self.provider = Mock(side_effect=self.complete)
        self.saved = []
        patches = [
            patch.object(main, "generate_with_provider", self.provider),
            patch.object(main, "configured_ai_models", return_value=[("mock:test", "mock", "test", "fake-key", "Test model")]),
            patch.object(main, "list_study_sets", side_effect=AssertionError("Import must not exclude previously imported questions")),
            patch.object(main, "search_web", side_effect=AssertionError("Import must not enrich source wording")),
            patch.object(main, "save_study_set", side_effect=lambda value: self.saved.append(copy.deepcopy(value))),
            patch.object(main, "_generation_workers", InlineExecutor()),
            patch.object(main, "generation_jobs", GenerationJobs()),
        ]
        for item in patches:
            item.start()
            self.addCleanup(item.stop)

    def complete(self, provider, model, key, prompt, schema, max_tokens):
        batch = json.loads(prompt.split("\n", 1)[1])
        return {"title": "Ignored model title", "items": [{"number": item["number"], "question": item["question"], "answer": item["answer"] or (item["options"][1] if item["options"] else "Mitochondrion"), "uncertain": False, "distractors": [] if item["options"] else ["Nucleus", "Ribosome", "Chloroplast"]} for item in batch]}

    def request(self, text=CHOICES, kind="multiple_choice", route="/api/generate", **fields):
        return self.client.post(route, data={"format": kind, "input_mode": "questionnaire", **fields}, files={"files": ("quiz.txt", text.encode(), "text/plain")})

    def test_fully_keyed_import_no_ai_and_short_documents_work(self):
        for kind in ("flashcards", "identification", "multiple_choice", "checkbox"):
            result = self.request(kind=kind)
            self.assertEqual(result.status_code, 200, result.text)
            self.assertEqual(result.json()["requested_count"], 2)
            self.assertFalse(result.json()["incomplete"])
            self.assertEqual(result.json()["items"][0]["answer_origin"], "provided")
        result = self.request("1. 2 + 2?\nAnswer: 4", "flashcards")
        self.assertEqual(result.status_code, 200, result.text)
        self.provider.assert_not_called()

    def test_identification_with_and_without_keys_gets_choices(self):
        for with_key in (True, False):
            source = IDENTIFICATION if with_key else IDENTIFICATION.split("\n")[0]
            result = self.request(source)
            self.assertEqual(result.status_code, 200, result.text)
            item = result.json()["items"][0]
            self.assertEqual(item["question"], "Identify the organelle that releases usable energy.")
            self.assertEqual(item["options"], ["Mitochondrion", "Nucleus", "Ribosome", "Chloroplast"])
            self.assertEqual(item["answer_origin"], "provided" if with_key else "inferred")
            self.assertEqual("AI-inferred" in item["explanation"], not with_key)

    def test_missing_key_preserves_original_choices_and_infers_only_answer(self):
        result = self.request(CHOICES.split("Answer key")[0])
        self.assertEqual(result.status_code, 200, result.text)
        item = result.json()["items"][0]
        self.assertEqual(item["options"], ["Nucleus", "Mitochondrion", "Ribosome", "Cell membrane"])
        self.assertEqual(item["answer_origin"], "inferred")

    def test_model_omission_or_uncertainty_saves_nothing(self):
        for payload in ({"items": []}, {"items": [{"number": "1", "question": "Identify the organelle that releases usable energy.", "answer": "Mitochondrion", "uncertain": True, "distractors": []}]}):
            self.provider.side_effect = None
            self.provider.return_value = payload
            result = self.request(IDENTIFICATION, route="/api/generation-jobs")
            job = self.client.get("/api/generation-jobs/" + result.json()["job_id"]).json()
            self.assertEqual(job["status"], "error", job)
            self.assertEqual(self.saved, [])

    def test_background_save_and_reopen_preserve_import_metadata(self):
        result = self.request(route="/api/generation-jobs")
        self.assertEqual(result.status_code, 202, result.text)
        job = self.client.get("/api/generation-jobs/" + result.json()["job_id"]).json()
        self.assertEqual(job["status"], "complete", job)
        self.assertEqual(job["requested"], 2)
        self.assertEqual(self.saved[0]["items"][0]["options"], ["Nucleus", "Mitochondrion", "Ribosome", "Cell membrane"])
        self.assertTrue(self.saved[0]["items"][0]["imported"])
        self.assertEqual(self.saved[0]["items"][0]["answer_origin"], "provided")

    def test_import_ignores_count_instead_of_dropping_or_inventing_questions(self):
        for count in (1, 200):
            result = self.request(question_count=str(count))
            self.assertEqual(result.status_code, 200, result.text)
            self.assertEqual(len(result.json()["items"]), 2)

    def test_200_question_imports_survive_batching_and_background_save(self):
        text = "\n".join(f"{i}. Name energy organelle number {i}.\nAnswer: Mitochondrion" for i in range(1, 201))
        for kind in ("flashcards", "multiple_choice"):
            result = self.request(text, kind, route="/api/generation-jobs")
            self.assertEqual(result.status_code, 202, result.text)
            job = self.client.get("/api/generation-jobs/" + result.json()["job_id"]).json()
            self.assertEqual(job["status"], "complete", job)
            self.assertEqual(job["requested"], 200)
            self.assertEqual(len(job["result"]["items"]), 200)
            self.assertEqual(job["result"]["items"][-1]["question"], "Name energy organelle number 200.")
            self.assertEqual(len(self.saved[-1]["items"]), 200)
        self.assertEqual(self.provider.call_count, 25)

    def test_201_question_import_is_rejected_without_saving(self):
        text = "\n".join(f"{i}. Question {i}?\nAnswer: Value" for i in range(1, 202))
        result = self.request(text, "flashcards")
        self.assertEqual(result.status_code, 422, result.text)
        self.assertIn("more than 200", result.json()["detail"])
        self.assertEqual(self.saved, [])

    def test_rejects_mutating_import_options_and_unknown_mode(self):
        for fields in ({"use_web": "true"}, {"focus_topic": "energy"}, {"existing_questions": '["earlier"]'}, {"input_mode": "unknown"}):
            for route in ("/api/generate", "/api/generation-jobs"):
                result = self.request(route=route, **fields)
                self.assertEqual(result.status_code, 422, result.text)
        self.provider.assert_not_called()

    def test_import_can_cancel_before_conversion_or_save(self):
        with patch.object(main, "check_generation_cancelled", side_effect=GenerationCancelled):
            with self.assertRaises(GenerationCancelled):
                main.import_questionnaire([CHOICES], "multiple_choice", "auto")
        self.assertEqual(self.saved, [])

    def test_docx_paragraph_import(self):
        document, buffer = Document(), BytesIO()
        for line in CHOICES.splitlines():
            document.add_paragraph(line)
        document.save(buffer)
        result = self.client.post("/api/generate", data={"format": "multiple_choice", "input_mode": "questionnaire"}, files={"files": ("quiz.docx", buffer.getvalue())})
        self.assertEqual(result.status_code, 200, result.text)
        self.assertEqual(result.json()["items"][0]["answer"], "Mitochondrion")


if __name__ == "__main__":
    unittest.main()
