"""Storage adapter regression tests; all Sheets calls stay in memory."""
from concurrent.futures import ThreadPoolExecutor
from contextlib import ExitStack, contextmanager
from copy import deepcopy
import re
import threading
import time
import unittest
from unittest.mock import Mock, patch
from urllib.parse import unquote

import accounts
from review_store import BatchedReviewStore, ReviewStoreError


class MemorySheetsAPI:
    """Small values/grid API adapter that retains physical spreadsheet rows."""
    def __init__(self):
        self.columns = {
            accounts.SETS_TAB: accounts.SET_COLUMNS,
            accounts.PROGRESS_TAB: accounts.PROGRESS_COLUMNS,
            accounts.REVIEWS_TAB: accounts.REVIEW_COLUMNS,
            accounts.SHARES_TAB: accounts.SHARE_COLUMNS,
            accounts.REPORTS_TAB: accounts.REPORT_COLUMNS,
        }
        self.tables = {tab: [list(columns)] for tab, columns in self.columns.items()}
        self.ids = {tab: index for index, tab in enumerate(self.tables, 1)}
        self.counts = {tab: 1000 for tab in self.tables}
        self.lock = threading.RLock()
        self.calls = []
        self.append_metadata = True
        self.after_append = None
        self.before_values_batch = None
        self.fail_after_grid_update = False

    def add(self, tab, **fields):
        self.tables[tab].append([str(fields.get(column, "")) for column in self.columns[tab]])

    def rows(self, tab):
        return accounts._parse_rows(deepcopy(self.tables[tab]), self.columns[tab])

    def write_range(self, target, rows):
        tab, cells = target.split("!", 1)
        first = int(re.match(r"A(\d+)", cells)[1])
        if first + len(rows) - 1 > self.counts[tab]:
            raise accounts.StorageError("Range exceeds the current grid bounds")
        for number, values in enumerate(rows, first):
            while len(self.tables[tab]) < number:
                self.tables[tab].append([])
            self.tables[tab][number - 1] = list(values)

    def __call__(self, method, path, *, params=None, body=None):
        path = unquote(path)
        with self.lock:
            self.calls.append((method, path, deepcopy(params), deepcopy(body)))
        if path == "/values:batchUpdate" and self.before_values_batch:
            self.before_values_batch()
        with self.lock:
            if method == "GET" and path == "":
                return {"sheets": [{"properties": {"title": tab, "sheetId": self.ids[tab], "gridProperties": {"rowCount": self.counts[tab]}}} for tab in self.tables]}
            if method == "GET" and path == "/values:batchGet":
                return {"valueRanges": [{"range": target, "values": deepcopy(self.tables[target.split("!", 1)[0]])} for target in params["ranges"]]}
            if method == "GET" and path.startswith("/values/"):
                return {"values": deepcopy(self.tables[path.split("/values/", 1)[1].split("!", 1)[0]])}
            if method == "POST" and path.endswith(":append"):
                tab = path.split("/values/", 1)[1].split("!", 1)[0]
                self.tables[tab].extend(deepcopy(body["values"]))
                number = len(self.tables[tab])
                if self.after_append:
                    self.after_append()
                return {"updates": {"updatedRange": f"'{tab}'!A{number}:V{number}"}} if self.append_metadata else {}
            if method == "PUT" and path.startswith("/values/"):
                self.write_range(path.split("/values/", 1)[1], body["values"])
                return {}
            if method == "POST" and path == "/values:batchUpdate":
                for entry in body["data"]:
                    self.write_range(entry["range"], entry["values"])
                return {}
            if method == "POST" and path == ":batchUpdate":
                for request in body["requests"]:
                    if "updateSheetProperties" in request:
                        props = request["updateSheetProperties"]["properties"]
                        tab = next(tab for tab, identity in self.ids.items() if identity == props["sheetId"])
                        self.counts[tab] = props["gridProperties"]["rowCount"]
                    else:
                        target = request["deleteDimension"]["range"]
                        tab = next(tab for tab, identity in self.ids.items() if identity == target["sheetId"])
                        del self.tables[tab][target["startIndex"]:target["endIndex"]]
                        self.counts[tab] -= target["endIndex"] - target["startIndex"]
                if self.fail_after_grid_update:
                    self.fail_after_grid_update = False
                    raise accounts.StorageError("Grid updated but reply was lost")
                return {}
        raise AssertionError(f"Unexpected API call: {method} {path}")


class StorageCapacityTests(unittest.TestCase):
    def setUp(self):
        self.stack = ExitStack()
        self.addCleanup(self.stack.close)
        self.sheets = MemorySheetsAPI()
        self.api = self.stack.enter_context(patch.object(accounts, "_api", side_effect=self.sheets))
        self.stack.enter_context(patch.object(accounts, "_schema_ready", True))
        self.stack.enter_context(patch.dict(accounts._row_cache, {}, clear=True))
        self.stack.enter_context(patch.dict(accounts._review_grids, {}, clear=True))
        self.stack.enter_context(patch.object(accounts.requests, "request", side_effect=AssertionError("Tests must never call live HTTP")))

    def study_set(self, identity="set", title="Original"):
        return {"id": identity, "user_id": "student", "title": title, "type": "flashcards", "created_at": "2026-11-01T00:00:00Z", "items": [{"card_id": "card", "question": "What is ATP?", "answer": "An energy carrier."}]}

    def seed_set(self, identity="set", title="Original"):
        accounts.save_study_set(self.study_set(identity, title))

    def review_store(self):
        store = BatchedReviewStore(accounts._load_review_rows, accounts._write_review_rows,
                                   accounts.PROGRESS_COLUMNS, accounts.REVIEW_COLUMNS,
                                   flush_seconds=0.01, refresh_seconds=60)
        self.stack.enter_context(patch.object(accounts, "_review_store", store))
        self.addCleanup(store.close)
        return store

    def test_study_set_snapshot_expires_at_thirty_seconds(self):
        self.seed_set()
        clock = [100.0]
        with patch.object(accounts.time, "monotonic", side_effect=lambda: clock[0]):
            self.assertEqual([row["id"] for row in accounts.list_study_sets("student")], ["set"])
            self.sheets.add(accounts.SETS_TAB, set_id="external", user_id="student", title="External", type="flashcards", items_json="[]", created_at="2026-11-02T00:00:00Z")
            clock[0] = 129.9
            self.assertEqual(len(accounts.list_study_sets("student")), 1)
            clock[0] = 130
            self.assertEqual(len(accounts.list_study_sets("student")), 2)
        self.assertEqual(sum(method == "GET" for method, *_ in self.sheets.calls), 2)

    def test_append_is_visible_immediately_without_refreshing_snapshot_age(self):
        self.seed_set()
        clock = [100.0]
        with patch.object(accounts.time, "monotonic", side_effect=lambda: clock[0]):
            accounts.list_study_sets("student")
            key = (accounts.SETS_TAB, tuple(accounts.SET_COLUMNS))
            loaded_at = accounts._row_cache[key][0]
            self.api.reset_mock()
            clock[0] = 110
            accounts.save_study_set(self.study_set("new", "Newly saved"))
            results = accounts.list_study_sets("student")
            self.assertEqual({row["id"] for row in results}, {"set", "new"})
            self.assertEqual(accounts._row_cache[key][0], loaded_at)
            self.assertEqual([call.args[0] for call in self.api.call_args_list], ["POST"])

    def test_update_writes_through_and_preserves_creation_time(self):
        self.seed_set()
        accounts.list_study_sets("student")
        self.api.reset_mock()
        replacement = {**self.study_set(title="Edited"), "created_at": "2099-01-01T00:00:00Z", "items": [{"question": "Edited?", "answer": "Yes."}]}
        self.assertTrue(accounts.update_study_set("student", "set", replacement))
        result = accounts.list_study_sets("student")[0]
        self.assertEqual(result["title"], "Edited")
        self.assertEqual(result["items"][0]["answer"], "Yes.")
        self.assertEqual(result["created_at"], "2026-11-01T00:00:00Z")
        self.assertEqual([call.args[0] for call in self.api.call_args_list], ["GET", "PUT"])

    def test_refresh_between_append_commit_and_reply_does_not_duplicate_row(self):
        self.seed_set()
        accounts.list_study_sets("student")
        def refresh_before_reply():
            accounts._invalidate_rows(accounts.SETS_TAB)
            self.assertEqual(len(accounts.list_study_sets("student")), 2)
        self.sheets.after_append = refresh_before_reply
        accounts.save_study_set(self.study_set("new"))
        rows = accounts._rows(accounts.SETS_TAB, accounts.SET_COLUMNS)
        self.assertEqual([number for number, _ in rows], [2, 3])
        self.assertEqual([row["set_id"] for _, row in rows], ["set", "new"])

    def test_append_without_physical_range_metadata_invalidates_snapshot(self):
        self.seed_set()
        accounts.list_study_sets("student")
        self.api.reset_mock()
        self.sheets.append_metadata = False
        accounts.save_study_set(self.study_set("new"))
        self.assertNotIn((accounts.SETS_TAB, tuple(accounts.SET_COLUMNS)), accounts._row_cache)
        self.assertEqual(len(accounts.list_study_sets("student")), 2)
        self.assertEqual([call.args[0] for call in self.api.call_args_list], ["POST", "GET"])

    def test_batch_load_retains_complete_legacy_history_and_physical_rows(self):
        self.sheets.add(accounts.PROGRESS_TAB, user_id="student", set_id="old", card_id="one", repetitions="3")
        self.sheets.tables[accounts.PROGRESS_TAB].append([])
        self.sheets.add(accounts.PROGRESS_TAB, user_id="other", set_id="old", card_id="two", repetitions="5")
        for index in range(75):
            self.sheets.add(accounts.REVIEWS_TAB, user_id="student", set_id="old", card_id=f"card-{index}", reviewed_at=f"2026-01-{index % 28 + 1:02}T00:00:00Z", rating="good", was_correct="true")
        progress, logs = accounts._load_review_rows()
        self.assertEqual([number for number, _ in progress], [2, 3, 4])
        self.assertEqual(progress[2][1]["repetitions"], "5")
        self.assertEqual(len(logs), 75)
        self.assertEqual(logs[-1][0], 76)
        self.api.assert_called_once_with("GET", "/values:batchGet", params={"ranges": ["CardProgress!A:J", "ReviewLogs!A:F"], "valueRenderOption": "UNFORMATTED_VALUE"})

    def test_incomplete_batch_load_fails_instead_of_silently_losing_history(self):
        self.api.side_effect = None
        self.api.return_value = {"valueRanges": [{"values": [accounts.PROGRESS_COLUMNS]}]}
        with self.assertRaisesRegex(accounts.StorageError, "incomplete review history"):
            accounts._load_review_rows()

    def test_review_write_grows_each_grid_once_then_uses_one_values_batch(self):
        body = {"valueInputOption": "RAW", "data": [
            {"range": "CardProgress!A1002:J1002", "values": [["student", "set", "card"]]},
            {"range": "ReviewLogs!A2501:F2501", "values": [["student", "set", "card"]]},
        ]}
        accounts._write_review_rows(body)
        self.assertEqual([(method, path) for method, path, *_ in self.sheets.calls], [("GET", ""), ("POST", ":batchUpdate"), ("POST", "/values:batchUpdate")])
        growth = self.sheets.calls[1][3]["requests"]
        self.assertEqual({request["updateSheetProperties"]["properties"]["gridProperties"]["rowCount"] for request in growth}, {2002, 3501})
        self.assertTrue(all(request["updateSheetProperties"]["fields"] == "gridProperties.rowCount" for request in growth))
        self.api.reset_mock()
        accounts._write_review_rows(body)
        self.api.assert_called_once_with("POST", "/values:batchUpdate", body=body)

    def test_uncertain_grid_reply_retries_absolute_counts_without_double_growth(self):
        body = {"valueInputOption": "RAW", "data": [{"range": "ReviewLogs!A1001:F1001", "values": [["student", "set", "card"]]}]}
        self.sheets.fail_after_grid_update = True
        with self.assertRaisesRegex(accounts.StorageError, "reply was lost"):
            accounts._write_review_rows(body)
        accounts._write_review_rows(body)
        growth = [call[3] for call in self.sheets.calls if call[1] == ":batchUpdate"]
        self.assertEqual(len(growth), 2)
        self.assertEqual(growth[0], growth[1])
        self.assertEqual(self.sheets.counts[accounts.REVIEWS_TAB], 2001)
        self.assertEqual(sum(path == "/values:batchUpdate" for _, path, *_ in self.sheets.calls), 1)

    def test_missing_grid_prevents_durable_write(self):
        self.sheets.tables.pop(accounts.REVIEWS_TAB)
        body = {"data": [{"range": "ReviewLogs!A2:F2", "values": [["student"]]}]}
        with self.assertRaisesRegex(accounts.StorageError, "ReviewLogs tab"):
            accounts._write_review_rows(body)
        self.assertFalse(any(path == "/values:batchUpdate" for _, path, *_ in self.sheets.calls))

    def test_review_grid_capacity_refreshes_after_physical_row_deletion(self):
        self.seed_set("deleted")
        self.sheets.add(accounts.PROGRESS_TAB, user_id="student", set_id="deleted", card_id="card")
        accounts._review_grids[accounts.PROGRESS_TAB] = (self.sheets.ids[accounts.PROGRESS_TAB], 1000)
        self.assertTrue(accounts.delete_study_set("student", "deleted"))
        self.assertEqual(self.sheets.counts[accounts.PROGRESS_TAB], 999)
        accounts._write_review_rows({"valueInputOption": "RAW", "data": [{"range": "CardProgress!A1000:J1000", "values": [["survivor", "set", "card"]]}]})
        self.assertGreaterEqual(self.sheets.counts[accounts.PROGRESS_TAB], 1000)
        self.assertEqual(self.sheets.tables[accounts.PROGRESS_TAB][999][:3], ["survivor", "set", "card"])

    def test_review_wrappers_preserve_storage_error_and_cause(self):
        store = Mock()
        failure = ReviewStoreError("durability failed")
        store.data.side_effect = failure
        store.save.side_effect = failure
        @contextmanager
        def failed_transaction(_key):
            raise failure
            yield
        store.transaction.side_effect = failed_transaction
        with patch.object(accounts, "_review_store", store):
            for call in (lambda: accounts.review_data("student"), lambda: accounts.save_card_review("student", "set", "card", {}, {})):
                with self.assertRaisesRegex(accounts.StorageError, "durability failed") as raised:
                    call()
                self.assertIs(raised.exception.__cause__, failure)
            with self.assertRaisesRegex(accounts.StorageError, "durability failed") as raised:
                with accounts.review_transaction("student", "set", "card"):
                    self.fail("Failed transaction must not enter")
            self.assertIs(raised.exception.__cause__, failure)

    def test_deletion_waits_for_commit_and_reloads_shifted_review_rows(self):
        self.seed_set("deleted")
        self.seed_set("survivor")
        for tab in (accounts.PROGRESS_TAB, accounts.REVIEWS_TAB):
            for identity in ("deleted", "survivor"):
                self.sheets.add(tab, user_id="student", set_id=identity, card_id="card", repetitions="1", rating="good")
        self.review_store()
        entered, release = threading.Event(), threading.Event()
        def block_commit():
            entered.set()
            if not release.wait(3):
                raise AssertionError("Test did not release blocked write")
        self.sheets.before_values_batch = block_commit
        progress = {"user_id": "student", "set_id": "survivor", "card_id": "card", "repetitions": "2"}
        review = {"user_id": "student", "set_id": "survivor", "card_id": "card", "rating": "good"}
        with ThreadPoolExecutor(max_workers=2) as pool:
            writing = pool.submit(accounts.save_card_review, "student", "survivor", "card", progress, review)
            try:
                self.assertTrue(entered.wait(3))
                deleting = pool.submit(accounts.delete_study_set, "student", "deleted")
                time.sleep(0.04)
                self.assertFalse(deleting.done())
                self.assertFalse(any(body and any("deleteDimension" in item for item in body.get("requests", [])) for _, _, _, body in self.sheets.calls))
            finally:
                release.set()
            writing.result(timeout=3)
            self.assertTrue(deleting.result(timeout=3))
        self.sheets.before_values_batch = None
        loaded_progress, loaded_logs = accounts.review_data("student")
        self.assertEqual([(row["set_id"], row["repetitions"]) for row in loaded_progress], [("survivor", "2")])
        self.assertEqual(len(loaded_logs), 2)
        accounts.save_card_review("student", "survivor", "card", {**progress, "repetitions": "3"}, review)
        persisted = [(number, row) for number, row in self.sheets.rows(accounts.PROGRESS_TAB) if row["user_id"]]
        self.assertEqual([(number, row["set_id"], row["repetitions"]) for number, row in persisted], [(2, "survivor", "3")])
        self.assertTrue(all(row["set_id"] == "survivor" for _, row in self.sheets.rows(accounts.REVIEWS_TAB) if row["user_id"]))


if __name__ == "__main__":
    unittest.main()
