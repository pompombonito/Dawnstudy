"""Synthetic questionnaire layouts; no private reference PDF text or images."""
import unittest
from io import BytesIO
from unittest.mock import patch

from pypdf import PdfReader, PdfWriter
from pypdf.generic import ArrayObject, DecodedStreamObject, DictionaryObject, FloatObject, NameObject

from pdf_questionnaire import extract_pdf_questionnaire
from questionnaire import parse_questionnaire
from test_pdf_figure_binding import choices, dominant_color, import_pdf, native_pdf


def marked_pdf(*, annotation=False, combined=False):
    raw = native_pdf([{"text": [
        (50, 750, "1. Select all the supported findings."),
        (50, 730, "A. First"), (50, 710, "B. Second"),
        (50, 690, "C. Third"), (50, 670, "D. Fourth"),
    ]}])
    writer = PdfWriter(clone_from=BytesIO(raw))
    page = writer.pages[0]
    boxes = [(48, 727, 120, 743), (48, 687, 120, 703)]
    if annotation:
        groups = [boxes] if combined else [[box] for box in boxes]
        annotations = []
        for group in groups:
            points = [value for left, bottom, right, top in group
                      for value in (left, top, right, top, left, bottom, right, bottom)]
            annotations.append(writer._add_object(DictionaryObject({
                NameObject("/Type"): NameObject("/Annot"), NameObject("/Subtype"): NameObject("/Highlight"),
                NameObject("/Rect"): ArrayObject([FloatObject(v) for v in (48, 687, 120, 743)]),
                NameObject("/QuadPoints"): ArrayObject([FloatObject(v) for v in points]),
                NameObject("/C"): ArrayObject([FloatObject(1), FloatObject(1), FloatObject(0)]),
            })))
        page[NameObject("/Annots")] = ArrayObject(annotations)
    else:
        marks = "\n".join(f"q 1 1 0 rg {left} {bottom} {right-left} {top-bottom} re f Q"
                          for left, bottom, right, top in boxes).encode()
        stream = DecodedStreamObject()
        stream.set_data(marks + b"\n" + page.get_contents().get_data())
        page[NameObject("/Contents")] = writer._add_object(stream)
    result = BytesIO()
    writer.write(result)
    return result.getvalue()


class PdfLayoutRecoveryTests(unittest.TestCase):
    def test_interleaved_columns_and_restarted_numbers_follow_physical_reading_order(self):
        records = import_pdf([{"text": [
            (50, 750, "1. Which left method?"), (330, 750, "1. Which right method?"),
            (50, 730, "A. First left"), (330, 730, "A. First right"),
            (50, 710, "B. Second left"), (330, 710, "B. Second right"),
            (50, 690, "Answer: A"), (330, 690, "Answer: B"),
        ]}])
        self.assertEqual([record["question"] for record in records], ["Which left method?", "Which right method?"])
        self.assertEqual([record["source_number"] for record in records], ["1", "1"])
        self.assertEqual([record["answer"] for record in records], ["First left", "Second right"])

    def test_geometric_order_keeps_highlight_answers_with_their_original_glyphs(self):
        raw = native_pdf([{"text": [
            (50, 750, "1. Which left method?"), (330, 750, "1. Which right method?"),
            (50, 730, "A. First left"), (330, 730, "A. First right"),
            (50, 710, "B. Second left"), (330, 710, "B. Second right"),
        ]}])
        writer = PdfWriter(clone_from=BytesIO(raw))
        annotations = []
        for left, bottom, right, top in [(48, 707, 150, 723), (328, 727, 440, 743)]:
            annotations.append(writer._add_object(DictionaryObject({
                NameObject("/Subtype"): NameObject("/Highlight"),
                NameObject("/Rect"): ArrayObject([FloatObject(v) for v in (left, bottom, right, top)]),
                NameObject("/QuadPoints"): ArrayObject([FloatObject(v) for v in (left, top, right, top, left, bottom, right, bottom)]),
            })))
        writer.pages[0][NameObject("/Annots")] = ArrayObject(annotations)
        output = BytesIO()
        writer.write(output)
        raw = output.getvalue()
        with patch("pdf_questionnaire._flattened_highlight_keys", return_value={}):
            text, _ = extract_pdf_questionnaire(raw, PdfReader(BytesIO(raw)), [0])
        self.assertEqual([record["answer"] for record in parse_questionnaire([text])], ["Second left", "First right"])

    def test_figure_between_stem_and_first_option_does_not_require_image_keyword(self):
        records = import_pdf([{
            "text": [(50, 750, "1. A culture developed irregular forms. Which organism is present?")]
                    + choices(50, 490) + [(50, 520, "FIGURE 1-1")],
            "images": [(50, 540, 160, 160, "red")],
        }])
        self.assertEqual(records[0]["image_labels"], ["Figure 1-1"])
        self.assertEqual(dominant_color(records[0]), 0)
        self.assertEqual(records[0]["answer"], "First")

    def test_figure_and_options_in_next_column_belong_to_left_column_stem(self):
        records = import_pdf([{
            "text": [(50, 100, "1. Which culture is present?")]
                    + choices(330, 490) + [(330, 380, "2. Which method is used?")]
                    + choices(330, 360) + [(330, 520, "FIGURE 1-2")],
            "images": [(330, 540, 160, 160, "blue")],
        }])
        self.assertEqual(records[0]["image_labels"], ["Figure 1-2"])
        self.assertNotIn("images", records[1])
        self.assertEqual(dominant_color(records[0]), 2)

    def test_figure_and_first_options_on_next_page_retain_nonvisual_stem_owner(self):
        records = import_pdf([
            {"text": [(50, 100, "1. The specimen has a distinctive shape. Which organism is present?")]},
            {"text": choices(50, 450) + [(50, 350, "2. Which method is used?")]
                     + choices(50, 330) + [(50, 480, "FIGURE 1-3")],
             "images": [(50, 500, 160, 160, "red")]},
        ])
        self.assertEqual(records[0]["image_labels"], ["Figure 1-3"])
        self.assertEqual(records[0]["source_refs"], ["PDF page 1", "PDF page 2"])
        self.assertNotIn("images", records[1])

    def test_explicit_explanation_after_caption_is_not_silently_removed(self):
        records = import_pdf([{
            "text": [(50, 750, "1. Which method is used?")] + choices(50, 730)
                    + [(50, 450, "FIGURE 1-4"),
                       (50, 430, "Explanation: A supplied reason is preserved."),
                       (50, 410, "This continuation is also part of the explanation."),
                       (50, 350, "2. Which method follows?")] + choices(50, 330),
            "images": [(50, 470, 160, 160, "blue")],
        }])
        self.assertEqual(records[0]["explanation"], "A supplied reason is preserved.\nThis continuation is also part of the explanation.")
        self.assertEqual(records[0]["answer"], "First")
        self.assertFalse(records[1].get("explanation"))

    def test_flattened_select_all_highlights_retain_every_supplied_answer(self):
        raw = marked_pdf()
        text, _ = extract_pdf_questionnaire(raw, PdfReader(BytesIO(raw)), [0])
        records = parse_questionnaire([text])
        self.assertEqual(records[0]["answer"], "First | Third")

    def test_captioned_plate_after_intervening_text_question_finds_only_unmatched_visual_stem(self):
        records = import_pdf([{
            "text": [(50, 750, "1. Which morphology is visible in this Gram stain?")]
                    + choices(50, 730)
                    + [(50, 650, "2. Which reagent is used in the assay?")]
                    + choices(50, 630) + [(50, 380, "FIGURE 3-1")],
            "images": [(50, 400, 160, 160, "blue")],
        }])
        self.assertEqual(records[0]["image_labels"], ["Figure 3-1"])
        self.assertNotIn("images", records[1])

    def test_flattened_highlight_uses_original_non_a_labels(self):
        # Build a fresh stream rather than modifying xref byte offsets.
        writer = PdfWriter(clone_from=BytesIO(marked_pdf()))
        data = writer.pages[0].get_contents().get_data()
        for old, new in [(b"A. First", b"E. First"), (b"B. Second", b"F. Second"), (b"C. Third", b"G. Third"), (b"D. Fourth", b"H. Fourth")]:
            data = data.replace(old, new)
        stream = DecodedStreamObject()
        stream.set_data(data)
        writer.pages[0][NameObject("/Contents")] = writer._add_object(stream)
        output = BytesIO()
        writer.write(output)
        raw = output.getvalue()
        text, _ = extract_pdf_questionnaire(raw, PdfReader(BytesIO(raw)), [0])
        record = parse_questionnaire([text])[0]
        self.assertEqual(record["labels"], ["E", "F", "G", "H"])
        self.assertEqual(record["answer"], "First | Third")

    def test_separate_select_all_annotations_retain_every_supplied_answer(self):
        raw = marked_pdf(annotation=True)
        with patch("pdf_questionnaire._flattened_highlight_keys", return_value={}):
            text, _ = extract_pdf_questionnaire(raw, PdfReader(BytesIO(raw)), [0])
        self.assertEqual(parse_questionnaire([text])[0]["answer"], "First | Third")

    def test_one_multiquad_select_all_annotation_retain_every_supplied_answer(self):
        raw = marked_pdf(annotation=True, combined=True)
        with patch("pdf_questionnaire._flattened_highlight_keys", return_value={}):
            text, _ = extract_pdf_questionnaire(raw, PdfReader(BytesIO(raw)), [0])
        self.assertEqual(parse_questionnaire([text])[0]["answer"], "First | Third")


if __name__ == "__main__":
    unittest.main()
