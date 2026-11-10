"""Offline contracts between questionnaire recovery, Sheets, sharing and games."""
import copy
import unittest
from unittest.mock import patch

import accounts
import live_games
from generation_jobs import merge_continued_generation
from questionnaire import convert_questionnaire, parse_questionnaire


SOURCE = """1. Which language provides std::cout?
E. C#
F. C++
G. Java
H. Python
Answer: F
Explanation: std::cout belongs to the C++ standard library.
"""


class QuestionnaireMetadataRoundtripTests(unittest.TestCase):
    def setUp(self):
        records = parse_questionnaire([SOURCE])
        records[0]["explanation_required"] = True
        item = convert_questionnaire(records, "multiple_choice", {})[0]
        self.card = {**item, "card_id": "source-card", "import_notices": ["Original source answer retained."]}
        self.study_set = {
            "id": "source-set", "user_id": "alice", "title": "Source questionnaire",
            "type": "multiple_choice", "items": [self.card], "sources": [],
            "created_at": "2026-11-10T00:00:00Z", "requested_count": 1,
            "material_fingerprint": "a" * 64, "incomplete": False,
        }

    def test_sheet_and_public_share_roundtrip_keeps_original_labels_rationale_and_card_identity(self):
        before = copy.deepcopy(self.study_set)
        with patch.object(accounts, "_append") as append:
            accounts.save_study_set(self.study_set)
        row = dict(zip(accounts.SET_COLUMNS, append.call_args.args[1]))
        share = {"token": "public-token", "user_id": "alice", "set_id": "source-set", "created_at": "2026-11-10"}

        def rows(tab, *_args, **_kwargs):
            return [(2, share)] if tab == accounts.SHARES_TAB else [(2, row)]

        with patch.object(accounts, "_rows", side_effect=rows):
            reopened = accounts.list_study_sets("alice")[0]
            shared = accounts.get_shared_study_set("public-token")
        self.assertEqual(reopened["items"], [self.card])
        self.assertEqual(shared["items"], [self.card])
        self.assertEqual(shared["items"][0]["options"], ["C#", "C++", "Java", "Python"])
        self.assertEqual(shared["items"][0]["option_labels"], ["E", "F", "G", "H"])
        self.assertEqual(shared["items"][0]["explanation_origin"], "provided")
        self.assertEqual(self.study_set, before)

    def test_live_question_preserves_source_labels_but_only_reveal_sends_rationale_and_import_metadata(self):
        with patch.object(live_games.time, "time", return_value=100):
            room = live_games.create("alice", self.study_set)
            self.addCleanup(live_games.ROOMS.pop, room["code"], None)
            room.update(phase="question", index=0, deadline=200)
            question = live_games.snapshot(room, "alice", {})["question"]
            self.assertEqual(question["options"], self.card["options"])
            self.assertEqual(question["option_labels"], self.card["option_labels"])
            for field in ("answer", "explanation", "explanation_origin", "import_notices"):
                self.assertNotIn(field, question)
            room["phase"] = "reveal"
            revealed = live_games.snapshot(room, "alice", {})["question"]
            self.assertEqual(revealed["answer"], "C++")
            self.assertEqual(revealed["explanation"], self.card["explanation"])
            self.assertEqual(revealed["explanation_origin"], "provided")
            self.assertEqual(revealed["import_notices"], self.card["import_notices"])

    def test_full_count_continuation_clears_pending_when_explanation_is_filled(self):
        pending = {**self.card, "explanation": "", "explanation_pending": True}
        pending.pop("explanation_origin", None)
        base = {**self.study_set, "items": [pending], "incomplete": True}
        merged = merge_continued_generation(base, {"items": [self.card], "incomplete": False})
        self.assertFalse(merged["incomplete"])
        self.assertFalse(merged["items"][0].get("explanation_pending", False))
        self.assertEqual(merged["items"][0]["explanation"], self.card["explanation"])
        self.assertEqual(merged["items"][0]["card_id"], "source-card")
        self.assertEqual(merged["items"][0]["option_labels"], ["E", "F", "G", "H"])

    def test_explanation_recovery_uses_fresh_original_source_options_with_matching_labels(self):
        old = {**self.card, "options": [*self.card["options"], "Old OCR phantom"], "explanation": "", "explanation_pending": True}
        old.pop("explanation_origin", None)
        records = parse_questionnaire([SOURCE])
        records[0]["explanation_required"] = True
        restored = convert_questionnaire(records, "multiple_choice", {}, existing_items=[old], allow_incomplete=True)[0]
        self.assertEqual(restored["options"], self.card["options"])
        self.assertEqual(restored["option_labels"], self.card["option_labels"])
        self.assertEqual(restored["card_id"], "source-card")
        self.assertEqual(restored["answer"], self.card["answer"])


if __name__ == "__main__":
    unittest.main()
