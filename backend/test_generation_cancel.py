"""Exercise cancellation through real generation routes and background workers."""
import copy
import threading
import unittest
from unittest.mock import patch

import test_generation_limits as fixtures

main = fixtures.main


class DeferredExecutor:
    def __init__(self):
        self.pending = []

    def submit(self, worker):
        self.pending.append(worker)

    def run_next(self):
        self.pending.pop(0)()


class GenerationCancellationRouteTests(unittest.TestCase):
    provide = fixtures.GenerationLimitTests.provide
    update = fixtures.GenerationLimitTests.update
    generate = fixtures.GenerationLimitTests.generate

    def setUp(self):
        fixtures.GenerationLimitTests.setUp(self)
        self.executor = DeferredExecutor()
        for item in (patch.object(main, "_generation_workers", self.executor),
                     patch.object(main, "_generation_inputs", {})):
            item.start()
            self.addCleanup(item.stop)

    def submit(self, count=16, **fields):
        response = self.generate(count, "/api/generation-jobs", **fields)
        self.assertEqual(response.status_code, 202, response.text)
        self.assertEqual(response.json()["status"], "queued")
        return response.json()["job_id"]

    def status(self, job_id):
        response = self.client.get(f"/api/generation-jobs/{job_id}")
        self.assertEqual(response.status_code, 200, response.text)
        return response.json()

    def cancel(self, job_id):
        response = self.client.post(f"/api/generation-jobs/{job_id}/cancel")
        self.assertEqual(response.status_code, 200, response.text)
        return response.json()

    def block_provider(self, error=None):
        entered, release = threading.Event(), threading.Event()

        def blocked(*args, **kwargs):
            entered.set()
            if not release.wait(5):
                raise AssertionError("Provider test was not released")
            if error:
                raise error
            return self.provide(*args, **kwargs)

        self.provider.side_effect = blocked
        return entered, release

    def start_worker(self, entered, release):
        thread = threading.Thread(target=self.executor.run_next, daemon=True)
        self.addCleanup(thread.join, 2)
        self.addCleanup(release.set)
        thread.start()
        self.assertTrue(entered.wait(3), "Worker did not reach the blocking operation")
        return thread

    def finish_worker(self, thread, release):
        release.set()
        thread.join(3)
        self.assertFalse(thread.is_alive(), "Worker did not stop after its current request")

    def test_queued_cancellation_releases_material_and_never_calls_provider(self):
        with patch.object(main, "save_study_set") as save:
            job_id = self.submit()
            captured = main._generation_inputs[job_id]
            self.assertTrue(captured)
            self.assertEqual(self.cancel(job_id)["status"], "cancelled")
            self.assertEqual(captured, [])
            self.assertNotIn(job_id, main._generation_inputs)
            self.executor.run_next()
            self.assertEqual(self.status(job_id)["status"], "cancelled")
            self.provider.assert_not_called()
            save.assert_not_called()
            self.assertFalse(self.sets)

    def test_running_cancellation_stops_before_next_batch_and_save(self):
        entered, release = self.block_provider()
        with patch.object(main, "save_study_set") as save:
            job_id = self.submit(24)
            thread = self.start_worker(entered, release)
            self.assertEqual(self.cancel(job_id)["status"], "cancelling")
            self.assertEqual(self.status(job_id)["status"], "cancelling")
            self.finish_worker(thread, release)
            job = self.status(job_id)
            self.assertEqual(job["status"], "cancelled")
            self.assertNotIn("result", job)
            self.assertEqual(self.provider.call_count, 1)
            save.assert_not_called()
            self.assertFalse(self.sets)

    def test_provider_failure_after_cancel_does_not_fallback_or_remain_active(self):
        models = [
            ("groq:first", "groq", "first", "test-key", "First model"),
            ("groq:second", "groq", "second", "test-key", "Second model"),
        ]
        error = main.ProviderError("groq", "first", 503, "Temporarily unavailable")
        entered, release = self.block_provider(error)
        with patch.object(main, "configured_ai_models", return_value=models), patch.object(main, "save_study_set") as save:
            job_id = self.submit()
            thread = self.start_worker(entered, release)
            self.cancel(job_id)
            self.finish_worker(thread, release)
            self.assertEqual(self.status(job_id)["status"], "cancelled")
            self.assertEqual(self.provider.call_count, 1)
            save.assert_not_called()
            # The stopped worker released admission, including the per-account lock.
            self.submit(1)

    def test_oversized_provider_failure_after_cancel_does_not_retry(self):
        self.material *= 20  # Ensure the existing 413 prompt-compaction retry applies.
        error = main.ProviderError("groq", "first", 413, "Request too large")
        entered, release = self.block_provider(error)
        job_id = self.submit()
        thread = self.start_worker(entered, release)
        self.cancel(job_id)
        self.finish_worker(thread, release)
        self.assertEqual(self.status(job_id)["status"], "cancelled")
        self.assertEqual(self.provider.call_count, 1)
        self.assertFalse(self.sets)

    def test_unexpected_provider_exception_after_cancel_finishes_cancelled(self):
        entered, release = self.block_provider(RuntimeError("Connection lost"))
        job_id = self.submit()
        thread = self.start_worker(entered, release)
        self.cancel(job_id)
        self.finish_worker(thread, release)
        self.assertEqual(self.status(job_id)["status"], "cancelled")
        self.assertEqual(self.provider.call_count, 1)
        self.assertFalse(self.sets)

    def test_cancel_after_error_handler_state_check_is_acknowledged_in_finally(self):
        for error in (RuntimeError("Connection lost"), main.HTTPException(503, "Provider unavailable")):
            with self.subTest(error=type(error).__name__):
                failed, entered, release = threading.Event(), threading.Event(), threading.Event()
                intercepted = []
                real_check = main.generation_jobs.is_cancelled

                def fail_provider(*args, **kwargs):
                    failed.set()
                    raise error

                def check_before_cancel(job_id):
                    observed = real_check(job_id)
                    if failed.is_set() and not intercepted:
                        intercepted.append(True)
                        entered.set()
                        if not release.wait(5):
                            raise AssertionError("Error-handler race test was not released")
                    return observed

                self.provider.reset_mock()
                self.provider.side_effect = fail_provider
                with patch.object(main.generation_jobs, "is_cancelled", side_effect=check_before_cancel), patch.object(main, "save_study_set") as save:
                    job_id = self.submit(1)
                    thread = self.start_worker(entered, release)
                    # The handler already observed False. Its late error update
                    # must not undo this cancellation or leave it active forever.
                    self.assertEqual(self.cancel(job_id)["status"], "cancelling")
                    self.finish_worker(thread, release)
                    self.assertEqual(self.status(job_id)["status"], "cancelled")
                    self.assertEqual(self.provider.call_count, 1)
                    save.assert_not_called()

    def test_continuation_cancellation_preserves_original_and_skips_extend(self):
        original = self.generate(4).json()
        original.update(requested_count=16, incomplete=True)
        saved = self.client.post("/api/study-sets", json=original)
        self.assertEqual(saved.status_code, 200, saved.text)
        set_id = saved.json()["id"]
        before = copy.deepcopy(self.sets[set_id])
        self.provider.reset_mock()
        entered, release = self.block_provider()
        with patch.object(main, "extend_study_set", wraps=main.extend_study_set) as extend, patch.object(main, "save_study_set") as save:
            job_id = self.submit(12, study_set_id=set_id)
            thread = self.start_worker(entered, release)
            self.cancel(job_id)
            self.finish_worker(thread, release)
            self.assertEqual(self.status(job_id)["status"], "cancelled")
            self.assertEqual(self.sets[set_id], before)
            self.assertEqual(self.provider.call_count, 1)
            extend.assert_not_called()
            save.assert_not_called()

    def test_cancellation_during_durable_save_preserves_completed_result(self):
        entered, release = threading.Event(), threading.Event()

        def save(study_set):
            entered.set()
            if not release.wait(5):
                raise AssertionError("Save test was not released")
            self.sets[study_set["id"]] = copy.deepcopy(study_set)

        with patch.object(main, "save_study_set", side_effect=save) as storage:
            job_id = self.submit(1)
            thread = self.start_worker(entered, release)
            saving = self.cancel(job_id)
            self.assertEqual((saving["status"], saving["stage"]), ("running", "saving"))
            self.assertFalse(saving["can_cancel"])
            self.finish_worker(thread, release)
            completed = self.status(job_id)
            self.assertEqual(completed["status"], "complete")
            self.assertEqual(self.sets[completed["result"]["id"]]["items"], completed["result"]["items"])
            self.assertEqual(self.cancel(job_id), completed)
            storage.assert_called_once()

    def test_cancel_endpoint_is_owner_scoped_and_unknown_ids_are_404(self):
        job_id = self.submit()
        captured = main._generation_inputs[job_id]
        original_user = self.user
        self.user = {"user_id": "other-student", "email": "other-student@mnl.ceu.edu.ph"}
        denied = self.client.post(f"/api/generation-jobs/{job_id}/cancel")
        self.assertEqual(denied.status_code, 404, denied.text)
        self.assertTrue(captured)
        self.assertFalse(main.generation_jobs.is_cancelled(job_id))
        missing = self.client.post("/api/generation-jobs/missing/cancel")
        self.assertEqual(missing.status_code, 404, missing.text)
        self.user = original_user
        self.assertEqual(self.cancel(job_id)["status"], "cancelled")
        self.executor.run_next()
        self.provider.assert_not_called()


if __name__ == "__main__":
    unittest.main()
