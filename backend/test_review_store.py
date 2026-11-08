import copy
from concurrent.futures import ThreadPoolExecutor
import re
import threading
import time
import unittest

from review_store import BatchedReviewStore, ReviewStoreError


PROGRESS = ["user_id", "set_id", "card_id", "repetitions"]
REVIEWS = ["user_id", "set_id", "card_id", "rating"]


class MemorySheets:
    def __init__(self):
        self.rows = {"CardProgress": {}, "ReviewLogs": {}}
        self.lock = threading.Lock()
        self.loads = 0
        self.writes = []

    def load(self):
        with self.lock:
            self.loads += 1
            return tuple([(number, copy.deepcopy(row)) for number, row in self.rows[tab].items()] for tab in ("CardProgress", "ReviewLogs"))

    def write(self, body):
        with self.lock:
            self.writes.append(copy.deepcopy(body))
            for entry in body["data"]:
                matched = re.fullmatch(r"(CardProgress|ReviewLogs)!A(\d+):[A-Z]+\d+", entry["range"])
                tab, number = matched[1], int(matched[2])
                columns = PROGRESS if tab == "CardProgress" else REVIEWS
                self.rows[tab][number] = dict(zip(columns, entry["values"][0]))


class ReviewStoreTests(unittest.TestCase):
    def make_store(self, sheets=None, **options):
        sheets = sheets or MemorySheets()
        store = BatchedReviewStore(sheets.load, options.pop("write", sheets.write), PROGRESS, REVIEWS, flush_seconds=options.pop("flush_seconds", 0.02), **options)
        self.addCleanup(store.close)
        return store, sheets

    @staticmethod
    def save(store, user="student", card="card", repetitions="1"):
        progress = dict(user_id=user, set_id="set", card_id=card, repetitions=repetitions)
        review = dict(user_id=user, set_id="set", card_id=card, rating="good")
        store.save(user, "set", card, progress, review)

    def test_25_distinct_students_coalesce_and_read_committed_copies(self):
        store, sheets = self.make_store(flush_seconds=0.15)
        barrier = threading.Barrier(25)
        def save(index):
            barrier.wait()
            self.save(store, user=f"student-{index}")
        with ThreadPoolExecutor(max_workers=25) as pool:
            list(pool.map(save, range(25)))
        self.assertEqual(len(sheets.writes), 1)
        self.assertEqual(len(sheets.writes[0]["data"]), 50)
        self.assertEqual(len(sheets.rows["ReviewLogs"]), 25)
        self.assertEqual(sheets.loads, 1)
        progress, logs = store.data("student-0")
        progress[0]["repetitions"] = "changed locally"
        logs.clear()
        self.assertEqual(store.data("student-0")[0][0]["repetitions"], "1")
        self.assertEqual(len(store.data("student-0")[1]), 1)

    def test_no_acknowledgment_or_uncommitted_cache_before_durable_write(self):
        entered, release = threading.Event(), threading.Event()
        sheets = MemorySheets()
        def write(body):
            entered.set()
            self.assertTrue(release.wait(3))
            sheets.write(body)
        store, _ = self.make_store(sheets, write=write)
        with ThreadPoolExecutor(max_workers=1) as pool:
            pending = pool.submit(self.save, store)
            self.assertTrue(entered.wait(3))
            self.assertFalse(pending.done())
            self.assertEqual(store.data("student"), ([], []))
            release.set()
            pending.result(timeout=3)
        self.assertEqual(len(store.data("student")[0]), 1)

    def test_timeout_after_commit_retries_identical_fixed_ranges_without_duplicates(self):
        sheets = MemorySheets()
        def write(body):
            sheets.write(body)
            if len(sheets.writes) == 1:
                raise TimeoutError("response lost after commit")
        store, _ = self.make_store(sheets, write=write)
        self.save(store)
        self.assertEqual(sheets.writes[0], sheets.writes[1])
        self.assertEqual(len(sheets.rows["CardProgress"]), 1)
        self.assertEqual(len(sheets.rows["ReviewLogs"]), 1)
        self.assertEqual(store.stats()["write_attempts"], 2)

    def test_failed_write_reports_failure_reloads_and_does_not_reuse_uncertain_rows(self):
        sheets = MemorySheets()
        attempts = []
        def fail(body):
            attempts.append(copy.deepcopy(body))
            if len(attempts) <= 2:
                raise OSError("unavailable")
            sheets.write(body)
        store, _ = self.make_store(sheets, write=fail)
        with self.assertRaises(ReviewStoreError):
            self.save(store)
        self.assertEqual(attempts[0], attempts[1])
        self.assertEqual(store.data("student"), ([], []))
        self.save(store)
        self.assertEqual(sheets.loads, 2)
        self.assertIn("CardProgress!A3:D3", [entry["range"] for entry in sheets.writes[0]["data"]])
        self.assertIn("ReviewLogs!A3:D3", [entry["range"] for entry in sheets.writes[0]["data"]])

    def test_legacy_history_keeps_physical_rows_and_new_logs_append(self):
        sheets = MemorySheets()
        sheets.rows["CardProgress"][7] = dict(user_id="student", set_id="set", card_id="card", repetitions="3")
        sheets.rows["ReviewLogs"][12] = dict(user_id="student", set_id="old-set", card_id="old-card", rating="hard")
        store, _ = self.make_store(sheets)
        self.save(store, repetitions="4")
        self.assertEqual(set(sheets.rows["CardProgress"]), {7})
        self.assertEqual(set(sheets.rows["ReviewLogs"]), {12, 13})
        self.assertEqual(len(store.data("student")[1]), 2)

    def test_same_card_transactions_serialize_calculation_and_save(self):
        store, _ = self.make_store(flush_seconds=0.001)
        def increment(_):
            with store.transaction(("student", "set", "card")):
                progress, _ = store.data("student")
                count = int(progress[0]["repetitions"]) if progress else 0
                self.save(store, repetitions=str(count + 1))
        with ThreadPoolExecutor(max_workers=8) as pool:
            list(pool.map(increment, range(8)))
        progress, logs = store.data("student")
        self.assertEqual(progress[0]["repetitions"], "8")
        self.assertEqual(len(logs), 8)

    def test_maintenance_waits_for_write_and_blocks_new_admissions_then_reloads(self):
        entered, release = threading.Event(), threading.Event()
        maintaining, finish_maintenance = threading.Event(), threading.Event()
        sheets = MemorySheets()
        def write(body):
            entered.set()
            self.assertTrue(release.wait(3))
            sheets.write(body)
        store, _ = self.make_store(sheets, write=write)
        def maintenance():
            with store.maintenance():
                maintaining.set()
                self.assertTrue(finish_maintenance.wait(3))
                with sheets.lock:
                    sheets.rows["CardProgress"].clear()
                    sheets.rows["ReviewLogs"].clear()
        with ThreadPoolExecutor(max_workers=3) as pool:
            pending = pool.submit(self.save, store)
            self.assertTrue(entered.wait(3))
            paused = pool.submit(maintenance)
            self.assertFalse(maintaining.wait(0.05))
            release.set()
            pending.result(timeout=3)
            self.assertTrue(maintaining.wait(3))
            read = pool.submit(store.data, "student")
            self.assertFalse(read.done())
            finish_maintenance.set()
            paused.result(timeout=3)
            self.assertEqual(read.result(timeout=3), ([], []))
        self.assertEqual(sheets.loads, 2)

    def test_close_drains_pending_reviews_without_waiting_full_flush_interval(self):
        store, sheets = self.make_store(flush_seconds=30)
        with ThreadPoolExecutor(max_workers=1) as pool:
            pending = pool.submit(self.save, store)
            deadline = time.monotonic() + 3
            while not store.stats()["pending"] and time.monotonic() < deadline:
                time.sleep(0.001)
            self.assertEqual(store.stats()["pending"], 1)
            store.close()
            pending.result(timeout=3)
        self.assertEqual(len(sheets.rows["ReviewLogs"]), 1)
        with self.assertRaises(ReviewStoreError):
            store.data("student")

    def test_expired_cache_refreshes_complete_history(self):
        store, sheets = self.make_store(refresh_seconds=0)
        self.assertEqual(store.data("student"), ([], []))
        sheets.rows["ReviewLogs"][2] = dict(user_id="student", set_id="old", card_id="old", rating="good")
        self.assertEqual(len(store.data("student")[1]), 1)
        self.assertEqual(sheets.loads, 2)

    def test_refresh_cannot_race_previously_loaded_save_admission(self):
        sheets = MemorySheets()
        save_loaded, release_save = threading.Event(), threading.Event()
        loading, release_load, wrote = threading.Event(), threading.Event(), threading.Event()
        pause_refresh = threading.Event()
        def load():
            snapshot = sheets.load()
            if pause_refresh.is_set():
                loading.set()
                self.assertTrue(release_load.wait(3))
            return snapshot
        def write(body):
            wrote.set()
            sheets.write(body)
        store = BatchedReviewStore(load, write, PROGRESS, REVIEWS, flush_seconds=0.001, refresh_seconds=60)
        self.addCleanup(store.close)
        store.data("student")
        ensure_loaded = store._ensure_loaded
        def pause_after_ensure():
            ensure_loaded()
            if threading.current_thread().name == "paused-save":
                save_loaded.set()
                self.assertTrue(release_save.wait(3))
        store._ensure_loaded = pause_after_ensure
        errors = []
        def save():
            try:
                self.save(store)
            except Exception as error:
                errors.append(error)
        pending = threading.Thread(target=save, name="paused-save")
        pending.start()
        self.assertTrue(save_loaded.wait(3))
        store._loaded_at = time.monotonic() - store._refresh_seconds - 1
        pause_refresh.set()
        with ThreadPoolExecutor(max_workers=1) as pool:
            refreshing = pool.submit(store.data, "student")
            self.assertTrue(loading.wait(3))
            release_save.set()
            self.assertFalse(wrote.wait(0.05))
            pause_refresh.clear()
            release_load.set()
            refreshing.result(timeout=3)
        pending.join(timeout=3)
        self.assertFalse(pending.is_alive())
        self.assertEqual(errors, [])
        self.assertEqual(len(store.data("student")[1]), 1)


if __name__ == "__main__":
    unittest.main()
