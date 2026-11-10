"""Real import routes with deterministic provider failures and no external I/O."""
import copy
import json
import unittest
from unittest.mock import patch
from uuid import uuid4

import test_generation_limits as fixtures
from test_generation_delivery import ManualTimer
from questionnaire import parse_questionnaire, convert_questionnaire

main = fixtures.main
CHOICES = "A. Alpha\nB. Beta\nC. Gamma\nD. Delta"


class ExplanationDeliveryTests(unittest.TestCase):
    def setUp(self):
        self.fixture = fixtures.GenerationLimitTests(methodName="runTest")
        self.fixture.setUp()
        self.addCleanup(self.fixture.doCleanups)
        self.client = self.fixture.client
        self.request_id = str(uuid4())
        self.calls = []
        self.fixture.provider.side_effect = self.provide
        ManualTimer.pending = []
        timer = patch.object(main.threading, "Timer", ManualTimer)
        timer.start()
        self.addCleanup(timer.stop)
        self.addCleanup(main._generation_inputs.clear)
        self.addCleanup(main._generation_input_sizes.clear)
        self.addCleanup(main._generation_retry_timers.clear)

    def provide(self, provider, _model, _key, prompt, _schema, _tokens):
        batch = json.loads(prompt.rsplit("\n", 1)[-1])
        self.calls.append((provider, copy.deepcopy(batch), tuple(main._provider_images.get())))
        return {"items": [{
            "number": record["number"], "question": record["question"],
            "answer": record["answer"] or record["options"][0], "uncertain": False,
            "explanation": record.get("explanation") or "The supplied answer follows from the defining relationship described in this question.",
            "distractors": [],
            "matching_pairs": [{"prompt": pair["prompt"], "match": pair["answer"]} for pair in record.get("matching_pairs", [])],
        } for record in batch]}

    def submit(self, source, kind="multiple_choice", **fields):
        return self.client.post("/api/generation-jobs", data={
            "format": kind, "input_mode": "questionnaire", "question_count": "10",
            "questionnaire_type_confirmed": "true", "client_request_id": self.request_id, **fields,
        }, files={"files": ("questionnaire.txt", source.encode(), "text/plain")})

    def job(self):
        response = self.client.get("/api/generation-jobs/" + self.request_id)
        self.assertEqual(response.status_code, 200, response.text)
        return response.json()

    def test_provided_explanations_bypass_models_in_every_quiz_format(self):
        text = "1. Which option is correct?\n" + CHOICES + "\nAnswer: A\nExplanation: First line of the supplied rationale.\nSecond line must remain unchanged."
        for kind in ("flashcards", "identification", "multiple_choice", "checkbox", "same_as_source"):
            with self.subTest(kind=kind):
                self.request_id = str(uuid4())
                self.assertEqual(self.submit(text, kind).status_code, 202)
                job = self.job()
                self.assertEqual(job["status"], "complete", job)
                item = job["result"]["items"][0]
                self.assertEqual(item["explanation"], "First line of the supplied rationale.\nSecond line must remain unchanged.")
                self.assertEqual(item["explanation_origin"], "provided")
        self.fixture.provider.assert_not_called()

    def test_only_missing_explanation_is_sent_to_ai_and_source_key_never_changes(self):
        source = ("1. Which first option is correct?\n" + CHOICES + "\nAnswer: A\nRationale: The source explains the first answer.\n"
                  "2. Which second option is correct?\n" + CHOICES + "\nAnswer: B")
        self.assertEqual(self.submit(source).status_code, 202)
        job = self.job()
        self.assertEqual(job["status"], "complete", job)
        self.assertEqual([r["number"] for r in self.calls[0][1]], ["2"])
        items = job["result"]["items"]
        self.assertEqual([item["answer"] for item in items], ["Alpha", "Beta"])
        self.assertEqual([item["explanation_origin"] for item in items], ["provided", "ai"])
        self.assertEqual(items[0]["explanation"], "The source explains the first answer.")

    def test_missing_model_explanation_keeps_known_answer_pending_then_resumes(self):
        source = "1. Choose the correct option?\n" + CHOICES + "\nAnswer: B"
        def omitted(*args):
            payload = self.provide(*args)
            for item in payload["items"]:
                item.pop("explanation")
            return payload
        self.fixture.provider.side_effect = omitted
        self.assertEqual(self.submit(source).status_code, 202)
        waiting = self.job()
        self.assertEqual(waiting["stage"], "waiting")
        self.assertEqual(waiting["completed"], 0)
        item = waiting["checkpoint"]["items"][0]
        self.assertEqual(item["answer"], "Beta")
        self.assertTrue(item["explanation_pending"])
        self.assertTrue(waiting["checkpoint"]["incomplete"])
        self.fixture.provider.side_effect = self.provide
        ManualTimer.pending[-1].fire()
        final = self.job()
        self.assertEqual(final["status"], "complete", final)
        self.assertEqual(final["result"]["items"][0]["card_id"], item["card_id"])
        self.assertEqual(final["result"]["items"][0]["answer"], "Beta")
        self.assertFalse(final["result"]["items"][0].get("explanation_pending", False))

    def test_two_hundred_explanations_complete_through_repeated_capacity_resets(self):
        source = "\n".join(f"{number}. Choose the option for question {number}?\n{CHOICES}\nAnswer: A" for number in range(1, 201))
        attempts = [0]
        def throttled(*args):
            attempts[0] += 1
            if attempts[0] % 3 == 0:
                raise main.ProviderError("groq", "groq:test", 429, "temporary capacity", retry_after=91)
            return self.provide(*args)
        self.fixture.provider.side_effect = throttled
        self.assertEqual(self.submit(source).status_code, 202)
        for position in range(100):
            if self.job()["status"] == "complete":
                break
            ManualTimer.pending[position].fire()
        final = self.job()
        self.assertEqual(final["status"], "complete", final)
        self.assertEqual((final["completed"], final["requested"]), (200, 200))
        self.assertFalse(final["result"]["incomplete"])
        self.assertTrue(all(item["explanation_origin"] == "ai" for item in final["result"]["items"]))
        self.assertEqual(len({item["card_id"] for item in final["result"]["items"]}), 200)
        self.assertEqual(sum(len(call[1]) for call in self.calls), 200)

    def test_supplied_matching_pairs_are_explained_without_resolving_them_again(self):
        source = "1. Match the values.\n_____First term\n_____Second term\nA. Alpha\nB. Beta\nAnswer: 1-B; 2-A"
        self.assertEqual(self.submit(source, "same_as_source").status_code, 202)
        final = self.job()
        self.assertEqual(final["status"], "complete", final)
        item = final["result"]["items"][0]
        self.assertEqual(item["matching_pairs"], [{"prompt": "First term", "answer": "Beta"}, {"prompt": "Second term", "answer": "Alpha"}])
        self.assertEqual(item["explanation_origin"], "ai")

    def test_image_explanations_use_a_vision_model_even_with_a_supplied_answer(self):
        choices = [("groq:text", "groq", "text", "key", "Text"), ("gemini:gemini-3.8-flash", "gemini", "gemini-3.8-flash", "key", "Vision")]
        source = "1. Identify the structure in the diagram.\n[PDF_IMAGE: data:image/webp;base64,AA==]\n" + CHOICES + "\nAnswer: A"
        with patch.object(main, "configured_ai_models", return_value=choices):
            self.assertEqual(self.submit(source, model=choices[0][0]).status_code, 202)
        final = self.job()
        self.assertEqual(final["status"], "complete", final)
        self.assertEqual([call[0] for call in self.calls], ["gemini"])
        self.assertEqual(len(self.calls[0][2]), 1)
        self.assertNotIn("images", self.calls[0][1][0])
        self.assertEqual(final["result"]["items"][0]["images"], ["data:image/webp;base64,AA=="])

    def test_restart_checkpoint_with_full_question_count_still_finishes_explanation_gaps(self):
        source = "1. Choose the option?\n" + CHOICES + "\nAnswer: A"
        with patch.object(main, "configured_ai_models", return_value=[]):
            self.assertEqual(self.submit(source).status_code, 202)
        before = self.job()
        from generation_jobs import GenerationJobs
        main.generation_jobs = GenerationJobs()
        self.assertEqual(self.submit(source, checkpoint_json=json.dumps(before["checkpoint"])).status_code, 202)
        final = self.job()
        self.assertEqual(final["status"], "complete", final)
        self.assertEqual(final["result"]["items"][0]["card_id"], before["checkpoint"]["items"][0]["card_id"])


if __name__ == "__main__":
    unittest.main()
