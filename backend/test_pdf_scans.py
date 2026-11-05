import unittest
import types
from io import BytesIO
from unittest.mock import patch, MagicMock

from PIL import Image, ImageDraw
from pypdf import PdfReader, PdfWriter
from pypdf.generic import NameObject, DictionaryObject, NumberObject, DecodedStreamObject

from pdf_questionnaire import (extract_pdf_questionnaire, extract_pdf_learning_material, extract_pdf_figures,
                               sample_figure_pages, MAX_PDF_FIGURE_SCAN_PAGES)
from questionnaire import parse_questionnaire
from questionnaire_ocr import scanned_figure_regions, ocr_questionnaire_image


def scan_pdf():
    image = Image.new("RGB", (600, 800), "white")
    ImageDraw.Draw(image).rectangle((80, 100, 280, 300), fill="navy")
    output = BytesIO()
    image.save(output, "PDF", resolution=72)
    image.close()
    return output.getvalue()


def native_figure_pdf():
    writer = PdfWriter()
    page = writer.add_blank_page(width=600, height=800)
    font = writer._add_object(DictionaryObject({NameObject("/Type"): NameObject("/Font"), NameObject("/Subtype"): NameObject("/Type1"), NameObject("/BaseFont"): NameObject("/Helvetica")}))
    figure = DecodedStreamObject()
    figure.set_data(Image.new("RGB", (100, 100), "navy").tobytes())
    figure.update({NameObject("/Type"): NameObject("/XObject"), NameObject("/Subtype"): NameObject("/Image"), NameObject("/Width"): NumberObject(100), NameObject("/Height"): NumberObject(100), NameObject("/ColorSpace"): NameObject("/DeviceRGB"), NameObject("/BitsPerComponent"): NumberObject(8)})
    page[NameObject("/Resources")] = DictionaryObject({NameObject("/Font"): DictionaryObject({NameObject("/F1"): font}), NameObject("/XObject"): DictionaryObject({NameObject("/Img"): writer._add_object(figure)})})
    stream = DecodedStreamObject()
    stream.set_data(b"BT /F1 14 Tf 50 750 Td (The blue region represents an important cell structure.) Tj ET\nq 150 0 0 150 50 550 cm /Img Do Q")
    page[NameObject("/Contents")] = writer._add_object(stream)
    output = BytesIO()
    writer.write(output)
    return output.getvalue()


class PdfScanTests(unittest.TestCase):
    def test_long_pdf_figure_scan_is_broad_and_bounded(self):
        selected = sample_figure_pages(range(127))
        self.assertEqual(len(selected), MAX_PDF_FIGURE_SCAN_PAGES)
        self.assertEqual(selected[0], 0)
        self.assertEqual(selected[-1], 126)
        self.assertLessEqual(max(right - left for left, right in zip(selected, selected[1:])), 3)
        self.assertEqual(sample_figure_pages(range(10)), list(range(10)))

    def test_native_pdf_text_extraction_reports_page_progress(self):
        raw = native_figure_pdf()
        progress = []
        text, labels = extract_pdf_learning_material(
            raw, PdfReader(BytesIO(raw)), [0], progress_callback=lambda *args: progress.append(args))
        self.assertIn("blue region", text)
        self.assertEqual(labels, ["PDF page 1"])
        self.assertEqual(progress, [(1, 1, 1)])

    def test_uploaded_scan_attaches_detected_diagram_only_to_its_question(self):
        image = Image.new("RGB", (600, 800), "white")
        ImageDraw.Draw(image).ellipse((80, 130, 280, 330), fill="navy")
        rows = ["level\tpage_num\tblock_num\tpar_num\tline_num\tword_num\tleft\ttop\twidth\theight\tconf\ttext"]
        lines = [(40, "1. Which shape is shown?"), (380, "A. Circle"), (420, "B. Square"), (460, "Answer: A"),
                 (580, "2. Which color?"), (620, "A. Red"), (660, "B. Green"), (700, "Answer: A")]
        for index, (top, text) in enumerate(lines, 1):
            rows.append(f"5\t1\t1\t1\t{index}\t1\t30\t{top}\t300\t20\t99\t{text}")
        engine = MagicMock()
        engine.GetTSVText.return_value = "\n".join(rows)
        context = MagicMock()
        context.__enter__.return_value = engine
        fake_ocr = types.SimpleNamespace(PyTessBaseAPI=MagicMock(return_value=context), PSM=types.SimpleNamespace(AUTO=3))
        fake_data = types.SimpleNamespace(data_path=lambda: "test-tessdata")
        with patch.dict("sys.modules", {"tesserocr": fake_ocr, "tessdata": fake_data}):
            text = ocr_questionnaire_image(image)
        records = parse_questionnaire([text])
        self.assertEqual(len(records[0].get("images", [])), 1)
        self.assertNotIn("images", records[1])
        self.assertEqual([record["answer"] for record in records], ["Circle", "Red"])

    def test_scanned_questionnaire_uses_ocr_and_does_not_attach_the_entire_page(self):
        raw = scan_pdf()
        recognized = "1. Which color is shown?\nA. Navy\nB. Red\nAnswer: A"
        with patch("pdf_questionnaire.ocr_questionnaire_image", return_value=recognized) as ocr:
            text, labels, skipped = extract_pdf_questionnaire(raw, PdfReader(BytesIO(raw)), [0], include_skipped=True)
        self.assertEqual(ocr.call_count, 1)
        self.assertEqual(labels, ["PDF page 1"])
        self.assertEqual(skipped, [])
        record = parse_questionnaire([text])[0]
        self.assertEqual(record["answer"], "Navy")
        self.assertNotIn("images", record)

    def test_unreadable_scanned_choices_are_reported_as_skipped(self):
        raw = scan_pdf()
        with patch("pdf_questionnaire.ocr_questionnaire_image", return_value="1. Which?\nA. First\nC. Unreadable"):
            text, labels, skipped = extract_pdf_questionnaire(raw, PdfReader(BytesIO(raw)), [0], include_skipped=True)
        self.assertEqual(text, "")
        self.assertEqual(labels, [])
        self.assertEqual(skipped, ["PDF page 1"])

    def test_scanned_learning_text_is_available_without_enabling_figure_extraction(self):
        raw = scan_pdf()
        with patch("pdf_questionnaire.ocr_learning_image", return_value=("A cell membrane surrounds the cell and controls transport.", [])) as ocr:
            text, labels, skipped = extract_pdf_learning_material(raw, PdfReader(BytesIO(raw)), [0], include_skipped=True)
        self.assertEqual(ocr.call_count, 1)
        self.assertIn("cell membrane", text)
        self.assertEqual(labels, ["PDF page 1"])
        self.assertEqual(skipped, [])

    def test_native_notes_figures_have_stable_source_ids_and_context(self):
        raw = native_figure_pdf()
        figures = extract_pdf_figures(raw, [0])
        self.assertEqual(len(figures), 1)
        self.assertEqual(figures[0]["id"], "pdf-p1-figure-1")
        self.assertEqual(figures[0]["source_ref"], "PDF page 1")
        self.assertIn("cell structure", figures[0]["context"])
        self.assertTrue(figures[0]["data_url"].startswith("data:image/webp;base64,"))
        with patch("pdf_questionnaire.ocr_learning_image", side_effect=AssertionError("Native notes must not need OCR")):
            text, _ = extract_pdf_learning_material(raw, PdfReader(BytesIO(raw)), [0])
        self.assertIn("blue region", text)

    def test_scanned_notes_figures_have_page_context(self):
        raw = scan_pdf()
        crop = {"data_url": "data:image/webp;base64,AA==", "context": "Cell diagram"}
        with patch("pdf_questionnaire.ocr_learning_image", return_value=("Cell diagram", [crop])):
            figures = extract_pdf_figures(raw, [0])
        self.assertEqual(figures, [{**crop, "id": "pdf-p1-scan-figure-1", "page": 1, "source_ref": "PDF page 1"}])

    def test_scanned_region_detection_keeps_diagram_and_discards_text(self):
        image = Image.new("RGB", (600, 800), "white")
        draw = ImageDraw.Draw(image)
        draw.rectangle((30, 20, 350, 50), fill="black")
        draw.ellipse((80, 150, 280, 350), fill="navy")
        tsv = "level\tpage_num\tblock_num\tpar_num\tline_num\tword_num\tleft\ttop\twidth\theight\tconf\ttext\n5\t1\t1\t1\t1\t1\t30\t20\t320\t30\t99\tQuestion"
        regions = scanned_figure_regions(image, tsv)
        self.assertEqual(len(regions), 1)
        self.assertGreater(regions[0][1], 100)
        self.assertLessEqual(regions[0][0], 80)
        self.assertGreaterEqual(regions[0][2], 280)


if __name__ == "__main__":
    unittest.main()
