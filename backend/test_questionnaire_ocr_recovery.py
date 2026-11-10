"""Measured OCR boundaries and figure context; no copied reference content."""
from io import StringIO
import csv
import unittest
from unittest.mock import Mock, patch

from PIL import Image, ImageDraw
import questionnaire_ocr as ocr
from questionnaire import parse_questionnaire


def tsv(lines):
    result = StringIO()
    fields = "level page_num block_num par_num line_num word_num left top width height conf text".split()
    writer = csv.DictWriter(result, fieldnames=fields, delimiter="\t", lineterminator="\n")
    writer.writeheader()
    for index, (left, top, value) in enumerate(lines, 1):
        cursor = left
        for word_number, word in enumerate(value.split(), 1):
            width = max(8, len(word) * 7)
            writer.writerow(dict(zip(fields, [5, 1, index, 1, 1, word_number, cursor, top, width, 12, 95, word])))
            cursor += width + 5
    return result.getvalue()


class OcrRecoveryTests(unittest.TestCase):
    def text(self, lines, highlighted=None):
        mask = Image.new("L", (600, 800))
        if highlighted:
            ImageDraw.Draw(mask).rectangle(highlighted, fill=255)
        try:
            return ocr.questionnaire_text_from_tsv(tsv(lines), mask, reading_order="blocks")
        finally:
            mask.close()

    def test_highlight_key_waits_until_wrapped_option_is_complete(self):
        text = self.text([(20, 20, "1. Which value is correct?"), (40, 50, "A. Alpha"),
                          (60, 66, "continues on another line"), (40, 90, "B. Beta"),
                          (20, 130, "2. Which value follows?"), (40, 160, "A. Gamma"), (40, 180, "B. Delta")],
                         (38, 48, 110, 64))
        records = parse_questionnaire([text])
        self.assertEqual(records[0]["answer"], "Alpha\ncontinues on another line")
        self.assertEqual(records[0]["options"], ["Alpha\ncontinues on another line", "Beta"])
        self.assertLess(text.index("B. Beta"), text.index("Answer: A"))
        self.assertEqual(records[1]["answer"], "")

    def test_bare_article_in_a_wrapped_option_is_never_a_new_choice(self):
        text = self.text([(20, 20, "1. Which mechanism applies?"), (40, 50, "A. Alpha"),
                          (40, 70, "B. Beta"), (40, 90, "C. Gamma"),
                          (40, 110, "D. Organisms have"), (60, 126, "a more efficient exchange")])
        record = parse_questionnaire([text])[0]
        self.assertEqual(record["labels"], list("ABCD"))
        self.assertEqual(record["options"][-1], "Organisms have\na more efficient exchange")

    def test_confused_label_requires_original_margin_and_neighboring_labels(self):
        text = self.text([(20, 20, "1. Which option is correct?"), (40, 50, "3. Alpha"),
                          (40, 70, "B. Beta"), (40, 90, "¢. Gamma"), (40, 110, "D. Delta"),
                          (20, 150, "2. Which option follows?"), (40, 180, "A. Next"), (40, 200, "B. Last")])
        records = parse_questionnaire([text])
        self.assertEqual(len(records), 2)
        self.assertEqual(records[0]["labels"], list("ABCD"))
        self.assertEqual(records[0]["options"], ["Alpha", "Beta", "Gamma", "Delta"])

    def test_missing_option_is_added_only_from_locally_recognized_pixels(self):
        source = Image.new("RGB", (600, 800), "white")
        original = tsv([(20, 20, "1. Which value is correct?"), (40, 50, "A. Alpha"),
                        (40, 80, "B. Beta"), (40, 125, "D. Delta")])
        recognized = tsv([(0, 2, "¢. Gamma")])
        api = Mock()
        api.__enter__ = Mock(return_value=api)
        api.__exit__ = Mock(return_value=False)
        api.GetTSVText.return_value = recognized
        with patch("tesserocr.PyTessBaseAPI", return_value=api):
            recovered = ocr._recover_missing_choice_rows(original, source)
        mask = Image.new("L", source.size)
        try:
            record = parse_questionnaire([ocr.questionnaire_text_from_tsv(recovered, mask, reading_order="blocks")])[0]
            self.assertEqual(record["options"], ["Alpha", "Beta", "Gamma", "Delta"])
            api.SetImage.assert_called_once()
        finally:
            mask.close()
            source.close()

    def test_caption_owner_overrides_misleading_image_distance_on_scanned_columns(self):
        source = Image.new("RGB", (600, 800), "white")
        ImageDraw.Draw(source).rectangle((330, 150, 480, 290), fill="red")
        data = tsv([(20, 20, "1. Which first value?"), (40, 50, "A. Alpha"), (40, 70, "B. Beta"),
                    (20, 600, "8. Identify the shown image."), (40, 630, "A. Red"), (40, 650, "B. Blue"),
                    (330, 300, "FIGURE 1-1"), (320, 350, "9. Which next value?"),
                    (340, 380, "A. Next"), (340, 400, "B. Last")])
        api = Mock()
        api.__enter__ = Mock(return_value=api)
        api.__exit__ = Mock(return_value=False)
        api.GetTSVText.return_value = data
        with patch("tesserocr.PyTessBaseAPI", return_value=api), \
             patch.object(ocr, "prepare_questionnaire_image", return_value=(source.copy(), Image.new("L", source.size))), \
             patch.object(ocr, "_recover_missing_choice_rows", return_value=data), \
             patch.object(ocr, "scanned_figure_regions", return_value=[(330, 150, 480, 290)]):
            text = ocr._ocr_questionnaire_image_local(source)
        source.close()
        records = parse_questionnaire([text])
        self.assertNotIn("images", records[0])
        self.assertEqual(records[1]["source_number"], "8")
        self.assertEqual(records[1]["image_labels"], ["Figure 1-1"])
        self.assertNotIn("images", records[2])


if __name__ == "__main__":
    unittest.main()
