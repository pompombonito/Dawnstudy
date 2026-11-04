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
    def test_explicit_multiple_answer_keys_keep_all_correct_options_and_source_type(self):
        for key in ("A | C", "A, C", "A and C", "(A); (C)"):
            with self.subTest(key=key):
                record = parse_questionnaire([f"1. Select the primary colors.\nA. Red\nB. Green\nC. Blue\nD. Purple\nAnswer: {key}"])[0]
                self.assertEqual(record["answer"], "Red | Blue")
                item = convert_questionnaire([record], "same_as_source", {})[0]
                self.assertEqual(item["quiz_type"], "checkbox")
                self.assertEqual(item["correct_answer"], "Red | Blue")
                self.assertEqual(item["options"], ["Red", "Green", "Blue", "Purple"])
        for key in ("A | A", "A | Z", "A |", "A | C | Z"):
            with self.subTest(key=key), self.assertRaises(QuestionnaireError):
                parse_questionnaire([f"1. Select colors.\nA. Red\nB. Green\nC. Blue\nAnswer: {key}"])

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
        return self.client.post(route, data={"format": kind, "input_mode": "questionnaire", "questionnaire_type_confirmed": "true", "questionnaire_type_policy": "convert", **fields}, files={"files": ("quiz.txt", text.encode(), "text/plain")})

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

    def test_generation_job_previews_mismatched_question_types_before_ai_or_saving(self):
        source = ("1. Which color is primary?\nA. Red\nB. Blue\nC. Green\nAnswer: A\n"
                  "2. Name the process plants use to make food.\nAnswer: Photosynthesis")
        result = self.request(source, "multiple_choice", route="/api/generation-jobs", questionnaire_type_confirmed="false")
        self.assertEqual(result.status_code, 409, result.text)
        preview = result.json()
        self.assertEqual(preview["code"], "questionnaire_type_mismatch")
        self.assertEqual(len(preview["mismatches"]), 1)
        self.assertEqual(preview["mismatches"][0]["question"], "Name the process plants use to make food.")
        self.assertEqual(preview["mismatches"][0]["source_type"], "identification")
        self.assertEqual(preview["mismatches"][0]["answer"], "Photosynthesis")
        self.assertIsNone(main.generation_jobs.recover(self.user["user_id"]))
        self.provider.assert_not_called()
        self.assertEqual(self.saved, [])

    def test_synchronous_import_route_uses_the_same_type_review_gate(self):
        source = "1. State one cell component.\nAnswer: Nucleus"
        result = self.request(source, "multiple_choice", route="/api/generate", questionnaire_type_confirmed="false")
        self.assertEqual(result.status_code, 409, result.text)
        self.assertEqual(result.json()["code"], "questionnaire_type_mismatch")
        self.provider.assert_not_called()
        self.assertEqual(self.saved, [])

    def test_user_can_confirm_conversion_or_keep_a_mixed_set_and_continue_policy_is_saved(self):
        source = ("1. Which color is primary?\nA. Red\nB. Blue\nC. Green\nAnswer: A\n"
                  "2. Name the process plants use to make food.\nAnswer: Photosynthesis")
        converted = self.request(source, "multiple_choice", route="/api/generation-jobs",
                                 questionnaire_type_confirmed="true", questionnaire_type_policy="convert")
        self.assertEqual(converted.status_code, 202, converted.text)
        converted_job = self.client.get("/api/generation-jobs/" + converted.json()["job_id"]).json()
        self.assertEqual(converted_job["status"], "complete", converted_job)
        converted_set = converted_job["result"]
        self.assertTrue(converted_set["questionnaire_type_confirmed"])
        self.assertEqual(converted_set["questionnaire_type_policy"], "convert")
        self.assertEqual(set(converted_set["items"][1]["options"]), {"Photosynthesis", "Nucleus", "Ribosome", "Chloroplast"})
        self.assertNotIn("quiz_type", converted_set["items"][1])

        mixed = self.request(source, "multiple_choice", route="/api/generation-jobs",
                             questionnaire_type_confirmed="true", questionnaire_type_policy="mixed")
        self.assertEqual(mixed.status_code, 202, mixed.text)
        mixed_job = self.client.get("/api/generation-jobs/" + mixed.json()["job_id"]).json()
        self.assertEqual(mixed_job["status"], "complete", mixed_job)
        mixed_set = mixed_job["result"]
        self.assertEqual(mixed_set["type"], "multiple_choice")
        self.assertEqual(mixed_set["questionnaire_type_policy"], "mixed")
        self.assertEqual(mixed_set["items"][1]["quiz_type"], "identification")
        self.assertEqual(mixed_set["items"][1]["answer"], "Photosynthesis")
        from live_games import card_kind
        self.assertEqual(card_kind(mixed_set["items"][1], mixed_set["type"]), "identification")

    def test_matching_is_previewed_and_preserved_when_single_answer_format_cannot_represent_it(self):
        source = ("1. Match each term to its description.\n__ First term\n__ Second term\n"
                  "A. First description\nB. Second description\nAnswer: 1-B; 2-A")
        preview = self.request(source, "multiple_choice", route="/api/generation-jobs", questionnaire_type_confirmed="false")
        self.assertEqual(preview.status_code, 409, preview.text)
        item_preview = preview.json()["mismatches"][0]
        self.assertEqual(item_preview["source_type"], "matching")
        self.assertTrue(item_preview["must_preserve"])
        self.assertEqual(item_preview["matching_prompts"], ["First term", "Second term"])
        confirmed = self.request(source, "multiple_choice", route="/api/generation-jobs",
                                 questionnaire_type_confirmed="true", questionnaire_type_policy="convert")
        self.assertEqual(confirmed.status_code, 202, confirmed.text)
        job = self.client.get("/api/generation-jobs/" + confirmed.json()["job_id"]).json()
        card = job["result"]["items"][0]
        self.assertEqual(card["quiz_type"], "matching")
        self.assertEqual(card["matching_pairs"][0], {"prompt": "First term", "answer": "Second description"})

    def test_same_as_source_does_not_request_a_mismatch_confirmation(self):
        source = "1. Name a mammal.\nAnswer: Dolphin"
        result = self.request(source, "same_as_source", route="/api/generation-jobs", questionnaire_type_confirmed="false")
        self.assertEqual(result.status_code, 202, result.text)
        job = self.client.get("/api/generation-jobs/" + result.json()["job_id"]).json()
        self.assertEqual(job["status"], "complete", job)

    def test_partial_questionnaire_is_saved_when_providers_are_unavailable(self):
        source = "1. First question?\nAnswer: Alpha\n2. Second question?"
        with patch.object(main, "configured_ai_models", return_value=[]):
            response = self.request(source, "flashcards", route="/api/generation-jobs")
        self.assertEqual(response.status_code, 202, response.text)
        job = self.client.get("/api/generation-jobs/" + response.json()["job_id"]).json()
        self.assertEqual(job["status"], "complete", job)
        self.assertTrue(job["result"]["incomplete"])
        self.assertEqual(job["result"]["requested_count"], 2)
        self.assertEqual([item["answer"] for item in job["result"]["items"]], ["Alpha"])
        self.assertIn("Questions 2 still need a verified answer", job["result"]["notices"][0])
        self.assertTrue(self.saved[0]["incomplete"])
        self.assertEqual(self.saved[0]["requested_count"], 2)

    def test_keyed_question_without_generated_choices_does_not_crash_partial_import(self):
        source = "1. Which is a primary color?\nA. Red\nB. Table\nC. Cloud\nD. Chair\nAnswer: A\n2. Name the process plants use to make food.\nAnswer: Photosynthesis"
        with patch.object(main, "configured_ai_models", return_value=[]):
            response = self.request(source, "multiple_choice", route="/api/generation-jobs")
        self.assertEqual(response.status_code, 202, response.text)
        job = self.client.get("/api/generation-jobs/" + response.json()["job_id"]).json()
        self.assertEqual(job["status"], "complete", job)
        self.assertTrue(job["result"]["incomplete"])
        self.assertEqual([item["question"] for item in job["result"]["items"]], ["Which is a primary color?"])
        self.assertEqual(job["result"]["items"][0]["options"], ["Red", "Table", "Cloud", "Chair"])

    def test_figure_stays_on_returned_card_without_entering_text_model_prompt(self):
        image = "data:image/webp;base64,AA=="
        source = f"1. Which option is shown?\n[PDF_IMAGE: {image}]\nA. Alpha\nB. Beta\nC. Gamma\nD. Delta"
        response = self.request(source)
        self.assertEqual(response.status_code, 200, response.text)
        item = response.json()["items"][0]
        self.assertEqual(item["images"], [image])
        prompt = self.provider.call_args.args[3]
        self.assertNotIn(image, prompt)
        self.assertIn('"image_count": 1', prompt)

    def test_questionnaire_partial_set_can_resume_without_reanswering_saved_cards(self):
        source = "1. First question?\nAnswer: Alpha\n2. Second question?"
        raw = source.encode()
        fingerprint = main.hashlib.sha256((self.user["user_id"] + "\0" + main.hashlib.sha256(raw).hexdigest()).encode()).hexdigest()
        base = {
            "id": "partial-import", "title": "quiz", "type": "flashcards",
            "items": [{"question": "First question?", "answer": "Alpha", "source_number": "1", "questionnaire_index": 1,
                       "imported": True, "answer_origin": "provided", "card_id": "saved-card", "quiz_type": "identification",
                       "questionnaire_type_confirmed": True, "questionnaire_type_policy": "mixed"}],
            "created_at": "2026-11-04T00:00:00+00:00", "requested_count": 2, "incomplete": True,
            "material_fingerprint": fingerprint, "page_ranges": {}, "focus_topic": "", "source_url": "", "sources": [],
        }
        saved = {base["id"]: copy.deepcopy(base)}
        def list_sets(_user_id):
            return [copy.deepcopy(saved[base["id"]])]
        def update_set(_user_id, set_id, changes):
            saved[set_id].update(copy.deepcopy(changes))
            return True

        with patch.object(main, "list_study_sets", side_effect=list_sets), patch.object(main, "update_study_set", side_effect=update_set):
            response = self.request(source, "flashcards", route="/api/generation-jobs", question_count="1", study_set_id=base["id"],
                                    questionnaire_type_confirmed="false", questionnaire_type_policy="convert")
            self.assertEqual(response.status_code, 202, response.text)
            job = self.client.get("/api/generation-jobs/" + response.json()["job_id"]).json()
        self.assertEqual(job["status"], "complete", job)
        self.assertFalse(job["result"]["incomplete"])
        self.assertEqual([item["question"] for item in job["result"]["items"]], ["First question?", "Second question?"])
        self.assertEqual(job["result"]["items"][0]["answer"], "Alpha")
        self.assertEqual(job["result"]["items"][0]["card_id"], "saved-card")
        self.assertEqual(job["result"]["questionnaire_type_policy"], "mixed")
        self.assertEqual(job["result"]["items"][1]["quiz_type"], "identification")
        self.assertEqual(self.provider.call_count, 1)

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
