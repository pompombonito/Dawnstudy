import json
import unittest
from unittest.mock import patch
from urllib.parse import unquote
import accounts


class LargeStudySetStorageTests(unittest.TestCase):
    def setUp(self):
        self.study_set = {
            "id": "large-set", "user_id": "student", "title": "Long practice set", "type": "multiple_choice",
            "created_at": "2026-10-30T00:00:00Z", "requested_count": 100,
            "items": [{"card_id": f"card-{i}", "question": f"Explain concept {i}. " + "Question detail. " * 12,
                       "answer": "Alpha", "correct_answer": "Alpha", "options": ["Alpha", "Bravo", "Delta", "Gamma"],
                       "explanation": "Supporting explanation 🌅. " * 15} for i in range(100)],
        }

    def packed_row(self):
        with patch.object(accounts, "_append") as append:
            accounts.save_study_set(self.study_set)
        tab, values = append.call_args.args
        self.assertEqual(tab, accounts.SETS_TAB)
        return values

    def test_long_100_question_sets_round_trip_across_cells_without_changing_items(self):
        values = self.packed_row()
        self.assertGreater(len(json.dumps(self.study_set["items"])), 40_000)
        self.assertEqual(len(values), len(accounts.SET_COLUMNS))
        row = dict(zip(accounts.SET_COLUMNS, values))
        self.assertTrue(row["items_json_2"])
        for column in accounts.SET_ITEM_COLUMNS:
            self.assertLessEqual(len(row[column].encode("utf-16-le")) // 2, 40_000)
        with patch.object(accounts, "_rows", return_value=[(2, row)]):
            restored = accounts.list_study_sets("student")[0]
        self.assertEqual(restored["items"], self.study_set["items"])
        self.assertEqual(restored["requested_count"], 100)

    def test_legacy_single_cell_rows_are_still_readable(self):
        original_columns = accounts.SET_COLUMNS[:13]
        row = {column: "" for column in original_columns}
        row.update(set_id="legacy", user_id="student", title="Old set", type="flashcards", items_json=json.dumps([{"question": "Old question", "answer": "Old answer"}]), sources_json="[]", created_at=self.study_set["created_at"])
        parsed = accounts._parse_rows([original_columns, [row[c] for c in original_columns]], accounts.SET_COLUMNS)
        with patch.object(accounts, "_rows", return_value=parsed):
            result = accounts.list_study_sets("student")[0]
        self.assertEqual(result["items"][0]["answer"], "Old answer")

    def test_schema_upgrade_appends_headers_without_rewriting_existing_data(self):
        headers = {accounts.USERS_TAB: accounts.USER_COLUMNS, accounts.SETS_TAB: accounts.SET_COLUMNS[:13], accounts.USAGE_TAB: accounts.USAGE_COLUMNS,
                   accounts.PROGRESS_TAB: accounts.PROGRESS_COLUMNS, accounts.REVIEWS_TAB: accounts.REVIEW_COLUMNS,
                   accounts.SHARES_TAB: accounts.SHARE_COLUMNS, accounts.REPORTS_TAB: accounts.REPORT_COLUMNS, **accounts.SOCIAL_TABLES}
        def api(method, path, **kwargs):
            if method == "GET" and path == "":
                return {"sheets": [{"properties": {"title": tab}} for tab in headers]}
            if method == "GET":
                tab = unquote(path).split("/values/")[1].split("!")[0]
                return {"values": [headers[tab]]}
            self.assertEqual(method, "PUT")
            self.assertIn("StudySets!A1:", unquote(path))
            self.assertEqual(kwargs["body"]["values"][0], accounts.SET_COLUMNS)
            return {}
        with patch.object(accounts, "_schema_ready", False), patch.object(accounts, "_api", side_effect=api) as calls:
            accounts.ensure_schema()
        self.assertEqual(sum(call.args[0] == "PUT" for call in calls.call_args_list), 1)

    def test_update_to_a_smaller_set_clears_old_chunks_and_preserves_creation_time(self):
        existing = dict(zip(accounts.SET_COLUMNS, self.packed_row()))
        replacement = {**self.study_set, "items": [{"question": "New question", "answer": "New answer"}], "requested_count": 1}
        with patch.object(accounts, "_rows", return_value=[(2, existing)]), patch.object(accounts, "_api") as api:
            self.assertTrue(accounts.update_study_set("student", "large-set", replacement))
        values = api.call_args.kwargs["body"]["values"][0]
        written = dict(zip(accounts.SET_COLUMNS, values))
        self.assertTrue(all(not written[c] for c in accounts.SET_ITEM_COLUMNS[1:]))
        self.assertEqual(written["created_at"], self.study_set["created_at"])
        self.assertEqual(json.loads(written["items_json"]), replacement["items"])
        self.assertIn(f":{chr(64 + len(accounts.SET_COLUMNS))}2", api.call_args.args[1])

    def test_unicode_chunks_never_exceed_the_cell_budget_or_lose_characters(self):
        text = "🌅" * 20001
        chunks = accounts._cell_chunks(text)
        self.assertEqual(len(chunks), 2)
        self.assertEqual("".join(chunks), text)
        self.assertTrue(all(len(value.encode("utf-16-le")) // 2 <= 40_000 for value in chunks))

    def test_oversized_payload_is_rejected_before_a_storage_write(self):
        oversized = {**self.study_set, "items": [{"question": "Too large", "answer": "x" * 400001}]}
        with patch.object(accounts, "_append") as append:
            with self.assertRaises(accounts.StorageError):
                accounts.save_study_set(oversized)
        append.assert_not_called()


if __name__ == "__main__":
    unittest.main()
