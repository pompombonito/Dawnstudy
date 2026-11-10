"""Offline end-to-end recovery contracts: no provider quota or real timers."""
import copy
import json
import time
import unittest
from unittest.mock import patch
from uuid import uuid4

import test_generation_limits as fixture
from generation_jobs import GenerationJobs

main = fixture.main
real_generate_with_provider = main.generate_with_provider
real_monotonic = time.monotonic


class ManualTimer:
    pending = []
    elapsed = 0

    def __init__(self, seconds, callback):
        self.seconds, self.callback, self.cancelled = seconds, callback, False
        self.deadline = real_monotonic() + self.elapsed + seconds

    def start(self):
        self.pending.append(self)

    def cancel(self):
        self.cancelled = True

    def fire(self):
        if not self.cancelled:
            # Firing a timer means its scheduled delay actually elapsed. Keep
            # per-provider reset deadlines realistic without waiting in tests.
            ManualTimer.elapsed = max(ManualTimer.elapsed, self.deadline - real_monotonic())
            with patch.object(main.time, "monotonic", side_effect=lambda: real_monotonic() + ManualTimer.elapsed):
                self.callback()


class DeliveryTests(unittest.TestCase):
    def setUp(self):
        self.fixture = fixture.GenerationLimitTests(methodName="runTest")
        self.fixture.setUp()
        self.addCleanup(self.fixture.doCleanups)
        self.client = self.fixture.client
        scoped_sets = patch.object(main, "list_study_sets", side_effect=lambda user_id: [
            {key: copy.deepcopy(value) for key, value in item.items() if key != "user_id"}
            for item in self.fixture.sets.values() if item.get("user_id") == user_id
        ])
        scoped_sets.start()
        self.addCleanup(scoped_sets.stop)
        self.request_id = str(uuid4())
        ManualTimer.pending = []
        ManualTimer.elapsed = 0
        timer_patch = patch.object(main.threading, "Timer", ManualTimer)
        timer_patch.start()
        self.addCleanup(timer_patch.stop)
        self.addCleanup(main._generation_inputs.clear)
        self.addCleanup(main._generation_input_sizes.clear)
        self.addCleanup(main._generation_retry_timers.clear)

    def submit(self, count=6, **fields):
        return self.fixture.generate(count, "/api/generation-jobs", client_request_id=self.request_id, **fields)

    def job(self):
        response = self.client.get("/api/generation-jobs/" + self.request_id)
        self.assertEqual(response.status_code, 200, response.text)
        return response.json()

    def interrupt(self):
        provide = self.fixture.provide
        calls = [0]

        def provider(*args):
            calls[0] += 1
            if calls[0] > 1:
                raise main.ProviderError("groq", "groq:test", 429, "temporary quota", retry_after=91)
            return provide(*args)

        self.fixture.provider.side_effect = provider
        submitted = self.submit()
        self.assertEqual(submitted.status_code, 202, submitted.text)
        job = self.job()
        self.assertEqual(job["status"], "queued")
        self.assertEqual(job["stage"], "waiting")
        self.assertEqual(job["completed"], 2)
        self.assertEqual(len(job["checkpoint"]["items"]), 2)
        self.assertTrue(job["can_cancel"])
        self.assertEqual(len(ManualTimer.pending), 1)
        self.assertGreater(ManualTimer.pending[0].seconds, 90)
        return job

    def test_retry_after_cooldown_releases_worker_and_resumes_without_repeating_items(self):
        before = self.interrupt()
        self.fixture.provider.side_effect = self.fixture.provide
        ManualTimer.pending[0].fire()
        job = self.job()
        self.assertEqual(job["status"], "complete", job)
        self.assertEqual(len(job["result"]["items"]), 6)
        self.assertEqual(job["result"]["items"][:2], before["checkpoint"]["items"])
        self.assertEqual(len(self.fixture.sets), 1)
        self.assertNotIn(self.request_id, main._generation_inputs)

    def test_browser_checkpoint_survives_api_restart_and_keeps_card_identity(self):
        before = self.interrupt()
        # The browser retains both its original files and validated checkpoint.
        main.generation_jobs = GenerationJobs()
        main._generation_inputs.clear()
        main._generation_input_sizes.clear()
        self.fixture.provider.side_effect = self.fixture.provide
        response = self.submit(checkpoint_json=json.dumps(before["checkpoint"]))
        self.assertEqual(response.status_code, 202, response.text)
        result = self.job()["result"]
        self.assertEqual(len(result["items"]), 6)
        self.assertEqual(result["items"][:2], before["checkpoint"]["items"])

    def test_repeated_request_and_post_save_restart_never_regenerate_or_duplicate(self):
        self.assertEqual(self.submit().status_code, 202)
        saved = copy.deepcopy(self.job()["result"])
        count = self.fixture.provider.call_count
        self.assertEqual(self.submit().json()["result"], saved)
        main.generation_jobs = GenerationJobs()
        for recovered in (self.job()["result"], self.submit().json()["result"]):
            self.assertEqual(recovered["id"], saved["id"])
            self.assertEqual(recovered["items"], saved["items"])
        self.assertEqual(self.fixture.provider.call_count, count)
        self.assertEqual(list(self.fixture.sets), [self.request_id])

    def test_cancelling_waiting_job_removes_retry_and_uploaded_material(self):
        self.interrupt()
        response = self.client.post("/api/generation-jobs/" + self.request_id + "/cancel")
        self.assertEqual(response.json()["status"], "cancelled")
        self.assertTrue(ManualTimer.pending[0].cancelled)
        self.assertNotIn(self.request_id, main._generation_inputs)
        calls = self.fixture.provider.call_count
        ManualTimer.pending[0].fire()
        self.assertEqual(self.fixture.provider.call_count, calls)
        self.assertEqual(self.fixture.sets, {})

    def test_checkpoint_cannot_silently_change_original_material(self):
        before = self.interrupt()
        main.generation_jobs = GenerationJobs()
        self.fixture.material = b"Different source material with enough readable content for generation. " * 8
        response = self.submit(checkpoint_json=json.dumps(before["checkpoint"]))
        self.assertEqual(response.status_code, 202)
        job = self.job()
        self.assertEqual(job["status"], "error")
        self.assertEqual(job["error_status"], 422)
        self.assertEqual(self.fixture.sets, {})

    def test_save_failure_retries_only_sync_without_more_model_requests(self):
        original = self.fixture.update
        failed = [False]

        def update(*args):
            if not failed[0]:
                failed[0] = True
                raise main.StorageError("temporary Sheets outage")
            return original(*args)

        with patch.object(main, "update_study_set", side_effect=update):
            self.assertEqual(self.submit().status_code, 202)
            self.assertEqual(self.job()["completed"], 6)
            self.assertEqual(self.job()["stage"], "waiting")
            calls = self.fixture.provider.call_count
            with patch.object(main, "generate", side_effect=AssertionError("A sync-only retry must not reread or regenerate the material")):
                ManualTimer.pending[0].fire()
        self.assertEqual(self.job()["status"], "complete")
        self.assertEqual(self.fixture.provider.call_count, calls)

    def test_save_committed_before_response_loss_is_not_appended_again(self):
        failed = [False]
        def save(value):
            self.fixture.sets[value["id"]] = copy.deepcopy(value)
            if not failed[0]:
                failed[0] = True
                raise main.StorageError("The write committed but its response was lost")
        with patch.object(main, "save_study_set", side_effect=save) as writer:
            self.assertEqual(self.submit().status_code, 202)
            self.assertEqual(self.job()["stage"], "waiting")
            calls = self.fixture.provider.call_count
            ManualTimer.pending[0].fire()
        self.assertEqual(self.job()["status"], "complete")
        self.assertEqual(writer.call_count, 1)
        self.assertEqual(list(self.fixture.sets), [self.request_id])
        self.assertEqual(self.fixture.provider.call_count, calls)

    def test_client_request_identifiers_are_scoped_to_the_account(self):
        self.assertEqual(self.submit().status_code, 202)
        self.fixture.user = {"user_id": "someone-else", "email": "someone@gmail.com"}
        response = self.client.get("/api/generation-jobs/" + self.request_id)
        self.assertEqual(response.status_code, 404)

    def test_busy_upload_memory_does_not_leave_a_terminal_job_for_an_unaccepted_request(self):
        main._generation_input_sizes["other-students"] = 128 * 1024 * 1024
        self.assertEqual(self.submit().status_code, 429)
        self.assertIsNone(main.generation_jobs.get(self.request_id, self.fixture.user["user_id"]))
        main._generation_input_sizes.clear()
        self.assertEqual(self.submit().status_code, 202)
        self.assertEqual(self.job()["status"], "complete")

    def test_worker_submission_restart_retains_request_for_automatic_retry(self):
        with patch.object(main._generation_workers, "submit", side_effect=RuntimeError("restarting")):
            self.assertEqual(self.submit().status_code, 202)
        self.assertEqual(self.job()["stage"], "waiting")
        self.assertIn(self.request_id, main._generation_inputs)
        ManualTimer.pending[0].fire()
        self.assertEqual(self.job()["status"], "complete")

    def test_all_four_notes_formats_finish_200_through_repeated_long_cooldowns(self):
        for study_format in ("flashcards", "identification", "multiple_choice", "checkbox"):
            with self.subTest(format=study_format):
                self.fixture.sets.clear()
                self.request_id = str(uuid4())
                calls, number = [0], [0]

                def provider(_provider, _model, _key, _prompt, schema, _budget):
                    calls[0] += 1
                    if calls[0] % 3 == 0:
                        raise main.ProviderError("groq", "groq:test", 429, "minute capacity", retry_after=91)
                    items = []
                    for _ in range(schema["properties"]["items"]["maxItems"]):
                        number[0] += 1
                        answer = "Alpha | Beta" if study_format == "checkbox" else "Alpha"
                        items.append({"question": f"What is concept {number[0]}?", "answer": answer,
                                      "correct_answer": answer, "options": ["Alpha", "Beta", "Gamma", "Delta"]})
                    return {"title": "Complete set", "items": items}

                self.fixture.provider.side_effect = provider
                submitted = self.submit(200, format=study_format)
                self.assertEqual(submitted.status_code, 202, submitted.text)
                position = len(ManualTimer.pending) - 1
                for _ in range(100):
                    if self.job()["status"] == "complete":
                        break
                    self.assertLess(position, len(ManualTimer.pending))
                    ManualTimer.pending[position].fire()
                    position += 1
                result = self.job()
                self.assertEqual(result["status"], "complete")
                self.assertEqual(result["result"]["type"], study_format)
                self.assertEqual(len(result["result"]["items"]), 200)
                self.assertFalse(result["result"]["incomplete"])
                self.assertEqual(len({item["card_id"] for item in result["result"]["items"]}), 200)

    def test_bad_output_on_one_source_window_does_not_disable_later_source_windows(self):
        window = [0]
        choice = ("groq:test", "groq", "test", "key", "Test")
        def prompt(_batch, _done):
            return str(window[0])
        def advance(_done):
            window[0] += 1
            return True
        prompt.advance_source_window = advance
        prompt.source_window_count = 2
        def provider(_provider, _model, _key, source, _schema, _tokens):
            if source.startswith("0"):
                raise main.ProviderError("groq", "groq:test", 200, "no usable grounded output")
            return {"title": "Recovered", "items": [{"question": "What is the supported concept?", "answer": "Alpha"}]}
        with patch.object(main, "configured_ai_models", return_value=[choice]), patch.object(main, "generate_with_provider", side_effect=provider):
            payload, _models, _fallback, incomplete = main.generate_with_fallback(
                prompt, {"properties": {"items": {"items": {"properties": {}}}}}, choice[0], 1, study_format="flashcards")
        self.assertEqual(len(payload["items"]), 1)
        self.assertFalse(incomplete)

    def test_deferral_reuses_document_and_resumes_the_same_source_window(self):
        import re
        self.fixture.material = ("Nucleic acids are polymers of nucleotides. " * 110
                                 + "RNA translates genetic information into proteins. " * 110
                                 + "DNA stores genetic information for inheritance. " * 110).encode()
        prompts = []
        provide = self.fixture.provide

        def provider(*args):
            prompts.append(re.search(r"<course_material>(.*?)</course_material>", args[3], re.S)[1])
            if len(prompts) == 2:
                raise main.ProviderError("groq", "groq:test", 429, "quota", retry_after=91)
            return provide(*args)

        self.fixture.provider.side_effect = provider
        with patch.object(main, "extract_material", wraps=main.extract_material) as reader:
            self.assertEqual(self.submit().status_code, 202)
            self.assertEqual(self.job()["completed"], 2)
            self.assertNotEqual(prompts[0], prompts[1])
            ManualTimer.pending[-1].fire()
            self.assertEqual(self.job()["status"], "complete", self.job())
            self.assertEqual(reader.call_count, 1)
        self.assertEqual(prompts[1], prompts[2])
        self.assertEqual(len(self.job()["result"]["items"]), 6)

    def test_short_provider_reset_does_not_erase_another_providers_long_reset(self):
        models = [("groq:test", "groq", "test", "key", "First"),
                  ("mistral:test", "mistral", "test", "key", "Second")]
        calls = []
        ready = [False]

        def provider(provider, *_args):
            calls.append(provider)
            if not ready[0]:
                raise main.ProviderError(provider, provider + ":test", 429, "quota",
                                         retry_after=30 if provider == "groq" else 300)
            return {"title": "Recovered", "items": [{"question": "What carries inherited information?", "answer": "DNA"}]}

        self.fixture.provider.side_effect = provider
        with patch.object(main, "configured_ai_models", return_value=models):
            self.assertEqual(self.submit(1, model=models[0][0]).status_code, 202)
            self.assertEqual(calls, ["groq", "mistral"])
            ManualTimer.pending[-1].fire()
            self.assertEqual(calls, ["groq", "mistral", "groq"])
            self.assertEqual(self.job()["stage"], "waiting")
            ready[0] = True
            ManualTimer.pending[-1].fire()
        self.assertEqual(calls, ["groq", "mistral", "groq", "groq"])
        self.assertEqual(self.job()["status"], "complete")

    def test_transient_failure_budget_survives_worker_deferral(self):
        self.fixture.provider.side_effect = main.ProviderError("groq", "groq:test", 503, "temporarily unavailable")
        self.assertEqual(self.submit(1).status_code, 202)
        self.assertLessEqual(ManualTimer.pending[-1].seconds, 5)
        ManualTimer.pending[-1].fire()
        self.assertEqual(self.fixture.provider.call_count, 2)
        self.assertEqual(ManualTimer.pending[-1].seconds, 60, "Do not restart the first transient retry indefinitely")
        self.fixture.provider.side_effect = self.fixture.provide
        ManualTimer.pending[-1].fire()
        self.assertEqual(self.job()["status"], "complete")

    def test_verified_diagrams_survive_deferral_without_more_extraction_or_vision_calls(self):
        image = "data:image/webp;base64,AA=="
        source_ref = "notes.docx · Part 1"
        figure = {"id": "figure-1", "data_url": image, "source_ref": "Part 1", "context": "Chloroplasts contain thylakoids."}
        def extract(_name, _raw, _range, **kwargs):
            kwargs["extracted_figures"].append(figure)
            return "[SOURCE: Part 1]\n" + self.fixture.material.decode(), ["Part 1"], []
        provide = self.fixture.provide
        calls = [0]
        def provider(*args):
            calls[0] += 1
            if calls[0] == 2:
                raise main.ProviderError("groq", "groq:test", 429, "quota", retry_after=91)
            self.assertIn("file-0-figure-1", main._material_figures.get())
            payload = provide(*args)
            for item in payload["items"]:
                item["figure_refs"] = ["file-0-figure-1"]
            return payload
        self.fixture.provider.side_effect = provider
        with patch.object(main, "extract_material", side_effect=extract) as reader, \
             patch.object(main, "describe_material_figures", return_value={"file-0-figure-1": {
                 **figure, "source_ref": source_ref, "description": figure["context"],
             }}) as vision:
            response = self.client.post("/api/generation-jobs", data={"client_request_id": self.request_id,
                "format": "flashcards", "question_count": "3", "include_images": "true"},
                files={"files": ("notes.docx", b"fixture", "application/octet-stream")})
            self.assertEqual(response.status_code, 202, response.text)
            ManualTimer.pending[-1].fire()
            self.assertEqual(self.job()["status"], "complete", self.job())
            self.assertEqual(reader.call_count, 1)
            self.assertEqual(vision.call_count, 1)
        self.assertTrue(all(item["images"] == [image] for item in self.job()["result"]["items"]))

    def test_http_200_upstream_quota_is_routed_as_a_quota_with_validated_partial_output(self):
        from unittest.mock import Mock
        response = Mock(ok=True, status_code=200, headers={"Retry-After": "91"})
        response.json.return_value = {"error": {"code": 429}, "choices": [{"message": {"content": json.dumps({
            "items": [{"question": "What absorbs light?", "answer": "Chlorophyll", "source_evidence": "Chlorophyll absorbs light"}]
        })}}]}
        token = main._generation_grounding_text.set("Chlorophyll absorbs light in chloroplasts.")
        try:
            with patch.object(main, "post_provider_json", return_value=response), patch.object(main, "generate_with_provider", real_generate_with_provider), self.assertRaises(main.ProviderError) as failure:
                main.generate_with_provider("openrouter", "openrouter/free", "key", "Use source", {
                    "properties": {"items": {"items": {"properties": {"source_evidence": {"type": "string"}}}}}
                }, 1000)
            self.assertEqual(failure.exception.status, 429)
            self.assertEqual(failure.exception.retry_after, 91)
            self.assertEqual(len(failure.exception.partial_items), 1)
        finally:
            main._generation_grounding_text.reset(token)


if __name__ == "__main__":
    unittest.main()
