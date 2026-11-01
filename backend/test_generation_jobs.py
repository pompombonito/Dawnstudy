import json
import threading
import unittest
from concurrent.futures import ThreadPoolExecutor

from generation_jobs import GenerationAlreadyRunning, GenerationCancelled, GenerationJobs, GenerationQueueFull, merge_continued_generation


class GenerationRecoveryTests(unittest.TestCase):
    def setUp(self):
        self.now = [100.0]
        self.store = GenerationJobs(clock=lambda: self.now[0])

    def test_refresh_discovers_the_same_active_job_without_starting_another(self):
        job_id = self.store.start("alice", 20)
        self.store.update(job_id, status="running", stage="generating", completed=8, model="GPT-OSS")
        restored = self.store.recover("alice")
        self.assertEqual((restored["job_id"], restored["completed"], restored["model"]), (job_id, 8, "GPT-OSS"))
        with self.assertRaises(GenerationAlreadyRunning) as duplicate:
            self.store.start("alice", 20)
        self.assertEqual(duplicate.exception.job_id, job_id)

    def test_completed_work_is_recoverable_until_acknowledged(self):
        job_id = self.store.start("alice", 10)
        self.store.update(job_id, status="complete", result={"items": [{"question": "Saved work"}]})
        self.assertEqual(self.store.recover("alice")["result"]["items"][0]["question"], "Saved work")
        self.assertTrue(self.store.acknowledge(job_id, "alice"))
        self.assertIsNone(self.store.recover("alice"))
        self.assertIsNotNone(self.store.get(job_id, "alice"))

    def test_other_accounts_cannot_read_or_acknowledge_a_job(self):
        job_id = self.store.start("alice", 10)
        self.assertIsNone(self.store.get(job_id, "bob"))
        self.assertIsNone(self.store.recover("bob"))
        self.assertFalse(self.store.acknowledge(job_id, "bob"))
        self.assertNotIn("user_id", self.store.get(job_id, "alice"))

    def test_acknowledging_running_job_does_not_hide_it(self):
        job_id = self.store.start("alice", 10)
        self.store.acknowledge(job_id, "alice")
        self.assertEqual(self.store.recover("alice")["job_id"], job_id)

    def test_latest_acknowledgement_does_not_reopen_an_old_completed_job(self):
        older = self.store.start("alice", 10)
        self.store.update(older, status="complete")
        newer = self.store.start("alice", 10)
        self.store.update(newer, status="complete")
        self.store.acknowledge(newer, "alice")
        self.assertIsNone(self.store.recover("alice"))

    def test_expiration_keeps_running_work_and_removes_old_terminal_jobs(self):
        completed = self.store.start("alice", 10)
        self.store.update(completed, status="complete")
        running = self.store.start("bob", 10)
        self.now[0] += 901
        self.assertIsNone(self.store.get(completed, "alice"))
        self.assertEqual(self.store.recover("bob")["job_id"], running)

    def test_concurrent_submissions_admit_only_one_job_per_account(self):
        def attempt(_):
            try:
                return self.store.start("alice", 10)
            except GenerationAlreadyRunning as error:
                return error.job_id
        with ThreadPoolExecutor(max_workers=8) as pool:
            job_ids = list(pool.map(attempt, range(24)))
        self.assertEqual(len(set(job_ids)), 1)
        self.assertEqual(len(self.store.jobs), 1)

    def test_queue_limit_and_public_snapshots(self):
        store = GenerationJobs(capacity=1)
        job_id = store.start("alice", 10)
        with self.assertRaises(GenerationQueueFull):
            store.start("bob", 10)
        store.update(job_id, status="complete", result={"items": ["original"]})
        store.get(job_id, "alice")["result"]["items"].append("changed")
        self.assertEqual(store.get(job_id, "alice")["result"]["items"], ["original"])


class GenerationCancellationTests(unittest.TestCase):
    def setUp(self):
        self.now = [100.0]
        self.store = GenerationJobs(capacity=1, clock=lambda: self.now[0])

    def test_only_the_owner_can_cancel_and_private_state_is_not_exposed(self):
        job_id = self.store.start("alice", 10)
        self.assertIsNone(self.store.cancel(job_id, "bob"))
        self.assertIsNone(self.store.cancel("missing", "alice"))
        self.assertFalse(self.store.is_cancelled(job_id))
        public = self.store.get(job_id, "alice")
        self.assertTrue(public["can_cancel"])
        for private in ("user_id", "_cancel_event", "_committing", "updated", "acknowledged"):
            self.assertNotIn(private, public)
        json.dumps(public)  # Thread primitives must never reach API JSON/deepcopy.

    def test_queued_cancellation_stops_work_and_releases_its_slot_immediately(self):
        job_id = self.store.start("alice", 10)
        cancelled = self.store.cancel(job_id, "alice")
        self.assertEqual((cancelled["status"], cancelled["stage"]), ("cancelled", "cancelled"))
        self.assertFalse(cancelled["can_cancel"])
        self.assertTrue(self.store.is_cancelled(job_id))
        with self.assertRaises(GenerationCancelled):
            self.store.raise_if_cancelled(job_id)
        self.assertFalse(self.store.update(job_id, status="running", stage="generating"))
        self.assertEqual(self.store.get(job_id, "alice")["status"], "cancelled")
        self.assertEqual(self.store.cancel(job_id, "alice"), cancelled)
        replacement = self.store.start("alice", 10)
        self.assertNotEqual(replacement, job_id)
        self.assertEqual(self.store.recover("alice")["job_id"], replacement)

    def test_running_cancellation_keeps_capacity_until_worker_acknowledges(self):
        job_id = self.store.start("alice", 10)
        self.store.update(job_id, status="running", stage="generating", completed=3)
        cancelling = self.store.cancel(job_id, "alice")
        self.assertEqual(cancelling["status"], "cancelling")
        self.assertFalse(cancelling["can_cancel"])
        self.assertEqual(self.store.cancel(job_id, "alice")["status"], "cancelling")
        with self.assertRaises(GenerationAlreadyRunning):
            self.store.start("alice", 10)
        with self.assertRaises(GenerationQueueFull):
            self.store.start("bob", 10)
        # Late provider callbacks retain useful counts without undoing cancellation.
        self.assertFalse(self.store.update(job_id, status="running", stage="generating", completed=5))
        self.assertEqual(self.store.get(job_id, "alice")["stage"], "cancelling")
        self.assertEqual(self.store.get(job_id, "alice")["completed"], 5)
        self.assertFalse(self.store.update(job_id, status="complete", result={"items": ["late"]}))
        self.assertEqual(self.store.get(job_id, "alice")["status"], "cancelling")
        self.assertEqual(self.store.finish_cancelled(job_id)["status"], "cancelled")
        self.assertNotIn("result", self.store.get(job_id, "alice"))
        self.store.start("bob", 10)

    def test_cancel_before_commit_prevents_saving(self):
        job_id = self.store.start("alice", 10)
        self.store.update(job_id, status="running")
        self.store.cancel(job_id, "alice")
        with self.assertRaises(GenerationCancelled):
            self.store.begin_commit(job_id)
        self.assertEqual(self.store.finish_cancelled(job_id)["status"], "cancelled")

    def test_commit_fence_preserves_durable_work_when_cancel_arrives_late(self):
        job_id = self.store.start("alice", 10)
        self.store.update(job_id, status="running")
        self.assertTrue(self.store.begin_commit(job_id))
        self.assertTrue(self.store.begin_commit(job_id))  # Safe for nested save paths.
        saving = self.store.cancel(job_id, "alice")
        self.assertEqual((saving["status"], saving["stage"]), ("running", "saving"))
        self.assertFalse(saving["can_cancel"])
        self.assertFalse(self.store.is_cancelled(job_id))
        self.store.raise_if_cancelled(job_id)
        self.assertEqual(self.store.finish_cancelled(job_id)["stage"], "saving")
        self.assertTrue(self.store.update(job_id, status="complete", stage="complete", result={"id": "saved"}))
        self.assertEqual(self.store.cancel(job_id, "alice")["result"], {"id": "saved"})
        self.assertFalse(self.store.update(job_id, status="error", message="late exception"))
        self.assertEqual(self.store.get(job_id, "alice")["status"], "complete")

    def test_cancel_and_commit_are_mutually_exclusive_under_race(self):
        with ThreadPoolExecutor(max_workers=2) as pool:
            for _ in range(24):
                store = GenerationJobs(capacity=1)
                job_id = store.start("alice", 10)
                store.update(job_id, status="running")
                barrier = threading.Barrier(2)

                def commit():
                    barrier.wait()
                    try:
                        store.begin_commit(job_id)
                        return "committed"
                    except GenerationCancelled:
                        return "cancelled"

                def cancel():
                    barrier.wait()
                    return store.cancel(job_id, "alice")

                commit_result = pool.submit(commit)
                cancel_result = pool.submit(cancel)
                outcome = commit_result.result()
                cancellation = cancel_result.result()
                if outcome == "committed":
                    self.assertEqual(cancellation["stage"], "saving")
                    self.assertFalse(store.is_cancelled(job_id))
                else:
                    self.assertEqual(cancellation["status"], "cancelling")
                    self.assertTrue(store.is_cancelled(job_id))
                    self.assertEqual(store.finish_cancelled(job_id)["status"], "cancelled")

    def test_cancelled_jobs_support_recovery_acknowledgement_and_expiry(self):
        job_id = self.store.start("alice", 10)
        self.store.cancel(job_id, "alice")
        self.assertEqual(self.store.recover("alice")["status"], "cancelled")
        self.assertFalse(self.store.acknowledge(job_id, "bob"))
        self.assertTrue(self.store.acknowledge(job_id, "alice"))
        self.assertIsNone(self.store.recover("alice"))
        self.now[0] += 901
        self.assertIsNone(self.store.get(job_id, "alice"))
        self.assertTrue(self.store.is_cancelled(job_id))
        with self.assertRaises(GenerationCancelled):
            self.store.raise_if_cancelled(job_id)
        self.assertIsNone(self.store.finish_cancelled(job_id))

    def test_cancelling_job_does_not_expire_while_provider_is_still_running(self):
        job_id = self.store.start("alice", 10)
        self.store.update(job_id, status="running")
        self.store.cancel(job_id, "alice")
        self.now[0] += 901
        self.assertEqual(self.store.recover("alice")["status"], "cancelling")
        self.assertTrue(self.store.acknowledge(job_id, "alice"))
        self.assertEqual(self.store.recover("alice")["status"], "cancelling")
        with self.assertRaises(GenerationQueueFull):
            self.store.start("bob", 10)


class ContinuedGenerationTests(unittest.TestCase):
    def setUp(self):
        self.base = {
            "id": "set-1", "created_at": "2026-10-30T00:00:00Z", "title": "My notes", "type": "multiple_choice",
            "items": [{"card_id": "original-card", "question": "What is ATP?", "answer": "Energy carrier"}],
            "requested_count": 3, "sources": [{"url": "https://example.edu/notes", "title": "Original"}],
            "page_ranges": {"0": "2-5"}, "focus_topic": "Chapter 2", "material_fingerprint": "original-hash",
        }

    def test_merge_preserves_old_answers_ids_and_scope_and_filters_duplicates(self):
        merged = merge_continued_generation(self.base, {
            "title": "Changed title", "items": [
                {"question": "WHAT IS ATP!", "answer": "Duplicate"},
                {"question": "What is ADP?", "answer": "Adenosine diphosphate"},
                {"question": "What is NADH?", "answer": "Electron carrier"},
                {"question": "Extra", "answer": "Ignore"},
            ], "sources": [{"url": "https://example.edu/new", "title": "New"}],
        })
        self.assertEqual(len(merged["items"]), 3)
        self.assertEqual(merged["items"][0], self.base["items"][0])
        self.assertEqual(merged["id"], "set-1")
        self.assertEqual(merged["title"], "My notes")
        self.assertEqual(merged["page_ranges"], {"0": "2-5"})
        self.assertEqual(merged["focus_topic"], "Chapter 2")
        self.assertEqual(merged["continued_set_id"], "set-1")
        self.assertFalse(merged["incomplete"])
        self.assertEqual(len(merged["sources"]), 2)

    def test_partial_continuation_keeps_original_target(self):
        merged = merge_continued_generation(self.base, {"items": [{"question": "What is ADP?"}], "requested_count": 2})
        self.assertEqual(merged["requested_count"], 3)
        self.assertEqual(len(merged["items"]), 2)
        self.assertTrue(merged["incomplete"])


if __name__ == "__main__":
    unittest.main()
