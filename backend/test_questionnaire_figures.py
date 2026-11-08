"""Figure provenance must survive every quiz format and partial-import retry."""
import copy
import unittest

from questionnaire import parse_questionnaire, convert_questionnaire


class QuestionnaireFigureTests(unittest.TestCase):
    image = "data:image/webp;base64,AA=="
    source = """[SOURCE: quiz.pdf · PDF page 1]
1. Which structure is shown?
A. First
B. Second
Answer: B
[SOURCE: quiz.pdf · PDF page 2]
[PDF_IMAGE: data:image/webp;base64,AA==]
[PDF_IMAGE_CAPTION: Figure 4-7]
2. Name the unit.
A. Joule
B. Meter
Answer: Joule
"""

    def test_cross_page_figure_labels_and_pages_follow_the_owner(self):
        records = parse_questionnaire([self.source])
        self.assertEqual(records[0]["images"], [self.image])
        self.assertEqual(records[0]["image_labels"], ["Figure 4-7"])
        self.assertEqual(records[0]["source_refs"], ["quiz.pdf · PDF page 1", "quiz.pdf · PDF page 2"])
        self.assertNotIn("images", records[1])
        self.assertNotIn("PDF_IMAGE_CAPTION", records[0]["question"])

    def test_all_quiz_formats_keep_the_same_labeled_figure_and_answer(self):
        records = parse_questionnaire([self.source])
        for kind in ("flashcards", "identification", "multiple_choice", "same_as_source", "checkbox"):
            with self.subTest(kind=kind):
                item = convert_questionnaire(records, kind, {})[0]
                self.assertEqual(item["images"], [self.image])
                self.assertEqual(item["image_labels"], ["Figure 4-7"])
                self.assertEqual(item["answer"], "Second")

    def test_retry_replaces_stale_figures_but_preserves_verified_answers(self):
        records = parse_questionnaire([self.source])
        existing = convert_questionnaire(records, "multiple_choice", {})
        existing[0].update(card_id="stable-card", images=["old"], image_labels=["Figure 99"], image_captions=["old description"])
        existing[1].update(images=[self.image], image_labels=["Figure 4-7"])
        before = copy.deepcopy(existing)
        result = convert_questionnaire(records, "multiple_choice", {}, existing_items=existing)
        self.assertEqual(result[0]["images"], [self.image])
        self.assertEqual(result[0]["image_labels"], ["Figure 4-7"])
        self.assertNotIn("image_captions", result[0])
        self.assertNotIn("images", result[1])
        self.assertNotIn("image_labels", result[1])
        self.assertEqual(result[0]["card_id"], "stable-card")
        self.assertEqual(result[0]["correct_answer"], existing[0]["correct_answer"])
        self.assertEqual(result[0]["options"], existing[0]["options"])
        self.assertEqual(existing, before)

    def test_labels_remain_aligned_when_some_images_have_no_caption(self):
        records = parse_questionnaire([f"[PDF_IMAGE: {self.image}]\n[PDF_IMAGE_CAPTION: Figure 1]\n1. What is shown?\n[PDF_IMAGE: {self.image}]\nAnswer: Cell"])
        self.assertEqual(records[0]["image_labels"], ["Figure 1", ""])
        self.assertEqual(len(records[0]["images"]), 2)


if __name__ == "__main__":
    unittest.main()
