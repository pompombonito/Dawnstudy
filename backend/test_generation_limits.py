"""Exercise actual API routes while replacing AI/Sheets I/O.

Native OCR is not used by these TXT-material tests; allow Windows QA to import
the API when the Linux-only OCR wheels are unavailable.
"""
import copy
import importlib.util
import json
import sys
import types
import unittest
from unittest.mock import Mock, patch
from fastapi.testclient import TestClient
import accounts
from generation_jobs import GenerationJobs

if importlib.util.find_spec("tesserocr") is None or importlib.util.find_spec("tessdata") is None:
    with patch.dict(sys.modules, {name: types.ModuleType(name) for name in ("tesserocr", "tessdata")}):
        import main
else:
    import main


class InlineExecutor:
    def submit(self, worker):
        worker()


class GenerationLimitTests(unittest.TestCase):
    def setUp(self):
        self.user = {"user_id": "ordinary-student", "email": "ordinary-student@mnl.ceu.edu.ph"}
        main.app.dependency_overrides[main.authenticated_user] = lambda: self.user
        main.app.dependency_overrides[main.onboarded_user] = lambda: self.user
        self.addCleanup(main.app.dependency_overrides.clear)
        self.sets = {}
        self.next_question = 0
        self.provider = Mock(side_effect=self.provide)
        self.storage_api = Mock(side_effect=AssertionError("Unexpected Sheets I/O, including daily quota storage"))
        patches = [
            patch.object(main, "configured_ai_models", return_value=[("groq:openai/gpt-oss-120b", "groq", "openai/gpt-oss-120b", "test-key", "Test model")]),
            patch.object(main, "generate_with_provider", self.provider),
            patch.object(main, "list_study_sets", side_effect=lambda uid: copy.deepcopy(list(self.sets.values()))),
            patch.object(main, "save_study_set", side_effect=lambda value: self.sets.update({value["id"]: copy.deepcopy(value)})),
            patch.object(main, "update_study_set", side_effect=self.update),
            patch.object(main, "generation_jobs", GenerationJobs()),
            patch.object(main, "_generation_workers", InlineExecutor()),
            patch.object(accounts, "_api", self.storage_api),
        ]
        for item in patches:
            item.start()
            self.addCleanup(item.stop)
        self.client = TestClient(main.app)
        self.material = b"Photosynthesis converts light into chemical energy. Chlorophyll absorbs light, and chloroplasts contain thylakoids. Carbon dioxide and water are converted into sugars and oxygen. " * 3

    def provide(self, provider, model, key, prompt, schema, max_tokens):
        count = schema["properties"]["items"]["maxItems"]
        start = self.next_question
        self.next_question += count
        return {"title": "Study notes", "items": [{"question": f"What is concept {i}?", "answer": f"Definition {i}"} for i in range(start, start + count)]}

    def update(self, user_id, set_id, changes):
        if set_id not in self.sets:
            return False
        self.sets[set_id].update(copy.deepcopy(changes))
        return True

    def generate(self, count, path="/api/generate", **fields):
        return self.client.post(path, data={"format": "flashcards", "question_count": str(count), **fields}, files={"files": ("notes.txt", self.material, "text/plain")})

    def test_200_questions_run_through_real_batching_and_save_and_update(self):
        generated = self.generate(200)
        self.assertEqual(generated.status_code, 200, generated.text)
        data = generated.json()
        self.assertEqual(len(data["items"]), 200)
        self.assertFalse(data["incomplete"])
        self.assertEqual(self.provider.call_count, 50)
        self.assertEqual(data["usage"], {"remaining": None, "limit": None, "resets_at": None, "unlimited": True})
        saved = self.client.post("/api/study-sets", json=data)
        self.assertEqual(saved.status_code, 200, saved.text)
        set_id = saved.json()["id"]
        updated = self.client.put(f"/api/study-sets/{set_id}", json={**data, "title": "Renamed 200-question set"})
        self.assertEqual(updated.status_code, 200, updated.text)
        self.assertEqual(len(updated.json()["items"]), 200)
        self.storage_api.assert_not_called()

    def test_more_than_five_generations_are_allowed_for_an_ordinary_account(self):
        for _ in range(7):
            result = self.generate(1)
            self.assertEqual(result.status_code, 200, result.text)
            self.assertTrue(result.json()["usage"]["unlimited"])
        self.storage_api.assert_not_called()

    def test_real_storage_accepts_200_questions_longer_than_one_cell(self):
        items = [{"question": f"Question {i}", "answer": "Detailed explanation. " * 30} for i in range(200)]
        with patch.object(main, "save_study_set", accounts.save_study_set), patch.object(accounts, "_append") as append:
            saved = self.client.post("/api/study-sets", json={"title": "Long set", "type": "flashcards", "items": items, "requested_count": 200})
        self.assertEqual(saved.status_code, 200, saved.text)
        row = dict(zip(accounts.SET_COLUMNS, append.call_args.args[1]))
        self.assertTrue(row["items_json_2"])
        self.assertEqual(len(json.loads("".join(row[c] for c in accounts.SET_ITEM_COLUMNS))), 200)

    def test_put_retries_missing_study_set_id_as_an_idempotent_upsert(self):
        payload = {"title": "Recovered PDF", "type": "same_as_source", "items": [
            {"card_id": "draft-card-1", "question": "What is shown?", "answer": "A diagram.", "images": ["data:image/webp;base64,AA=="]}
        ]}
        recovered = self.client.put("/api/study-sets/client-draft-id", json=payload)
        self.assertEqual(recovered.status_code, 200, recovered.text)
        self.assertEqual(recovered.json()["id"], "client-draft-id")
        self.assertEqual(recovered.json()["items"][0]["card_id"], "draft-card-1")
        updated = self.client.put("/api/study-sets/client-draft-id", json={**payload, "title": "Recovered and updated"})
        self.assertEqual(updated.status_code, 200, updated.text)
        self.assertEqual(updated.json()["title"], "Recovered and updated")
        self.assertEqual(len(self.sets), 1)

    def test_background_generation_saves_all_200_and_is_recoverable(self):
        submitted = self.generate(200, "/api/generation-jobs")
        self.assertEqual(submitted.status_code, 202, submitted.text)
        job = self.client.get(f"/api/generation-jobs/{submitted.json()['job_id']}").json()
        self.assertEqual(job["status"], "complete", job)
        self.assertEqual(job["requested"], 200)
        self.assertEqual(len(job["result"]["items"]), 200)
        self.assertNotIn("persistence_error", job["result"])
        self.assertEqual(len(self.sets[job["result"]["id"]]["items"]), 200)

    def test_background_generation_binds_and_resets_ocr_cancellation(self):
        observed = []

        def capture_ocr_context(**_kwargs):
            callback = main.ocr_cancellation.get()
            observed.append(callback)
            self.assertTrue(callable(callback))
            callback()
            return {"id": "ocr-cancel-test", "items": [{"question": "Q", "answer": "A"}],
                    "requested_count": 1, "incomplete": False}

        with patch.object(main, "generate", side_effect=capture_ocr_context):
            submitted = self.generate(1, "/api/generation-jobs")

        self.assertEqual(submitted.status_code, 202, submitted.text)
        job = self.client.get(f"/api/generation-jobs/{submitted.json()['job_id']}").json()
        self.assertEqual(job["status"], "complete", job)
        self.assertEqual(len(observed), 1)
        self.assertIsNone(main.ocr_cancellation.get())

    def test_continuation_preserves_60_existing_questions_and_finishes_at_200(self):
        original = self.generate(60).json()
        original.update(requested_count=200, incomplete=True)
        saved = self.client.post("/api/study-sets", json=original).json()
        first_card = saved["items"][0]
        result = self.generate(140, "/api/generation-jobs", study_set_id=saved["id"])
        self.assertEqual(result.status_code, 202, result.text)
        job = self.client.get(f"/api/generation-jobs/{result.json()['job_id']}").json()
        self.assertEqual(job["status"], "complete", job)
        self.assertEqual(job["result"]["requested_count"], 200)
        self.assertEqual(len(job["result"]["items"]), 200)
        self.assertEqual(job["result"]["items"][0], first_card)
        self.assertFalse(job["result"]["incomplete"])
        self.assertNotIn("persistence_error", job["result"])
        self.assertEqual(len(self.sets[saved["id"]]["items"]), 200)

    def test_existing_question_exclusions_include_all_200(self):
        prior = [f"What is earlier concept {i}?" for i in range(200)]
        result = self.generate(1, existing_questions=json.dumps(prior))
        self.assertEqual(result.status_code, 200, result.text)
        self.assertEqual(result.json()["previous_question_count"], 200)
        self.assertIn(prior[-1], self.provider.call_args.args[3])

    def test_zero_and_201_are_rejected_before_ai_work_on_both_routes(self):
        for path in ("/api/generate", "/api/generation-jobs"):
            for count in (0, 201):
                result = self.generate(count, path)
                self.assertEqual(result.status_code, 422, result.text)
        self.provider.assert_not_called()

    def test_saved_sets_cannot_exceed_200_items_or_requested_questions(self):
        item = {"question": "Sample", "answer": "Answer"}
        for body in ({"items": [item] * 201, "requested_count": 200}, {"items": [item], "requested_count": 201}):
            result = self.client.post("/api/study-sets", json={"title": "Too many", "type": "flashcards", **body})
            self.assertEqual(result.status_code, 422, result.text)

    def test_openapi_advertises_200_for_generation_and_saved_sets(self):
        schema = self.client.get("/openapi.json").json()
        for path in ("/api/generate", "/api/generation-jobs"):
            ref = schema["paths"][path]["post"]["requestBody"]["content"]["multipart/form-data"]["schema"]["$ref"].split("/")[-1]
            self.assertEqual(schema["components"]["schemas"][ref]["properties"]["question_count"]["maximum"], 200)
        self.assertEqual(schema["components"]["schemas"]["SavedStudySet"]["properties"]["items"]["maxItems"], 200)


if __name__ == "__main__":
    unittest.main()
