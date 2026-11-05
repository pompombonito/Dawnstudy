"""Regression coverage for already-saved, incorrectly paired PDF figures."""

import copy
import hashlib
import unittest
from unittest.mock import patch

import figure_repairs


RED = "data:image/webp;base64,cmVk"
PINK = "data:image/webp;base64,cGluaw=="
UNKNOWN = "data:image/webp;base64,b3RoZXI="
SMEAR = "data:image/webp;base64,c21lYXI="
HASHES = {
    hashlib.sha256(RED.encode()).hexdigest(): "Figure 1-4",
    hashlib.sha256(PINK.encode()).hexdigest(): "Figure 1-5",
    hashlib.sha256(SMEAR.encode()).hexdigest(): "Figure 1-7",
}


def card(medium, images=None, **overrides):
    result = {
        "question": f"The bacterial isolate shown below on {medium} agar was isolated from a routine stool culture. Which species is most likely?",
        "answer": "The saved correct answer", "answer_origin": "provided",
        "options": ["Unchanged option A", "Unchanged option B"],
        "correct_answer": 1, "card_id": f"card-{medium}", "imported": True,
        "source_refs": ["Print 2.pdf · PDF page 6"],
    }
    if images is not None:
        result["images"] = images
    return {**result, **overrides}


def smear_cards():
    return [
        card("other", question="The gram-stained smear shows an organism isolated from a blood culture after bowel surgery. Identify the isolate.",
             card_id="smear", source_refs=["Print 2.pdf · PDF page 8"]),
        card("other", [SMEAR], question="Pseudomembranous colitis caused by Clostridium difficile is best confirmed by which of the following laboratory findings?",
             card_id="colitis", image_labels=[""], image_captions=["Incorrectly assigned smear"],
             source_refs=["Print 2.pdf · PDF page 9"]),
    ]


class LegacyFigureRepairsTest(unittest.TestCase):
    def setUp(self):
        self.patcher = patch.object(figure_repairs, "KNOWN_IMAGE_SHA256", HASHES)
        self.patcher.start()
        self.addCleanup(self.patcher.stop)

    def repair(self, items):
        before = copy.deepcopy(items)
        result = figure_repairs.repair_legacy_questionnaire_figures(items)
        self.assertEqual(items, before, "A read migration must not mutate stored cards")
        return result

    def test_split_pair_restores_xld_and_cin_without_touching_answers(self):
        items = [card("XLD"), card("CIN", [PINK, RED], image_labels=["", ""])]
        result = self.repair(items)
        for original, corrected, image, label in zip(items, result, [RED, PINK], ["Figure 1-4", "Figure 1-5"]):
            self.assertEqual(corrected["images"], [image])
            self.assertEqual(corrected["image_labels"], [label])
            self.assertEqual(corrected["image_captions"], [label])
            for key in ("answer", "answer_origin", "options", "correct_answer", "card_id", "source_refs"):
                self.assertEqual(corrected[key], original[key])

    def test_missing_verified_asset_does_not_invent_image(self):
        items = [card("XLD", [PINK]), card("CIN", [PINK])]
        self.assertEqual(self.repair(items)[0], items[0])

    def test_unrecognized_scan_or_extra_images_are_preserved(self):
        items = [card("XLD", [UNKNOWN]), card("CIN", [RED, PINK, UNKNOWN])]
        self.assertEqual(self.repair(items), items)

    def test_non_imported_and_unrelated_cards_are_not_repaired_or_asset_sources(self):
        items = [card("XLD", imported=False), card("CIN", [RED, PINK], imported=False),
                 card("XLD"), {"question": "Unrelated question", "images": [RED, PINK], "imported": True}]
        result = self.repair(items)
        self.assertEqual(result[:2], items[:2])
        self.assertEqual(result[3], items[3])
        self.assertEqual(result[2]["images"], [RED])
        only_generated_assets = items[:3]
        self.assertEqual(self.repair(only_generated_assets), only_generated_assets)

    def test_repair_is_idempotent_and_replaces_stale_caption(self):
        result = self.repair([card("XLD", [RED], image_captions=["Misleading caption"])])
        self.assertEqual(result[0]["image_labels"], ["Figure 1-4"])
        self.assertEqual(self.repair(result), result)

    def test_malformed_legacy_image_metadata_does_not_crash_or_get_replaced(self):
        items = [card("XLD", "unexpected-string"), card("CIN", [RED, PINK]), None]
        result = self.repair(items)
        self.assertEqual(result[0], items[0])
        self.assertIsNone(result[2])

    def test_page_leading_smear_moves_to_its_visual_question(self):
        items = smear_cards()
        result = self.repair(items)
        self.assertEqual(result[0]["images"], [SMEAR])
        self.assertEqual(result[0]["image_labels"], ["Figure 1-7"])
        for field in ("images", "image_labels", "image_captions"):
            self.assertNotIn(field, result[1])
        for before, after in zip(items, result):
            for field in ("answer", "options", "correct_answer", "card_id", "source_refs"):
                self.assertEqual(before[field], after[field])
        self.assertEqual(self.repair(result), result)

    def test_smear_is_not_removed_without_unique_verified_owner(self):
        items = smear_cards()
        self.assertEqual(self.repair(items[1:]), items[1:])
        duplicate = [*items, dict(items[0])]
        self.assertEqual(self.repair(duplicate), duplicate)

    def test_smear_repair_preserves_unknown_attachments(self):
        for index in (0, 1):
            items = smear_cards()
            items[index]["images"] = [SMEAR, UNKNOWN]
            self.assertEqual(self.repair(items), items)

    def test_smear_repair_requires_same_source_document_when_known(self):
        items = smear_cards()
        items[0]["source_refs"] = ["Different.pdf · PDF page 8"]
        self.assertEqual(self.repair(items), items)


if __name__ == "__main__":
    unittest.main()
