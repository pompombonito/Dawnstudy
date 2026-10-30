import unittest
from concurrent.futures import ThreadPoolExecutor

from generation_jobs import GenerationAlreadyRunning, GenerationJobs, GenerationQueueFull, merge_continued_generation


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
