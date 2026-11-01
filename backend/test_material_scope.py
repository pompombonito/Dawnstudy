"""Page-selection regressions with real extraction routes and mocked external I/O."""
from io import BytesIO
import json
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch

from fastapi import HTTPException
from pptx import Presentation
from pptx.util import Inches

from material_scope import selected_pages
import test_generation_limits as fixtures

main = fixtures.main
PAGE_TEXT = [
    "Photosynthesis captures sunlight in chloroplasts and converts carbon dioxide and water into sugar. The first page explains chlorophyll pigments.",
    "Cellular respiration releases chemical energy from glucose. The second page explains mitochondria and ATP synthesis in living cells.",
    "Ribosomes synthesize proteins using messenger RNA templates. The final page explains amino acids and translation of genetic information.",
]


def fake_pdf():
    return SimpleNamespace(pages=[Mock(extract_text=Mock(return_value=text)) for text in PAGE_TEXT])


def slide_bytes():
    presentation = Presentation()
    for text in PAGE_TEXT:
        slide = presentation.slides.add_slide(presentation.slide_layouts[6])
        slide.shapes.add_textbox(Inches(1), Inches(1), Inches(8), Inches(2)).text = text
    output = BytesIO()
    presentation.save(output)
    return output.getvalue()


class SelectedPagesTests(unittest.TestCase):
    def test_all_document_aliases_select_every_page(self):
        for expression in (
            "", " \t\n ", "all", "All pages", "ALL PAGES", "  all   pages  ",
            "all page", "all slides", "All Slide", "every page", "every slide",
            "whole document", "entire document", "full document", "whole file",
            "entire file", "full file", "whole presentation", "entire presentation",
            "full presentation", "everything", "*", "all\u00a0pages", "ＡＬＬ　ＰＡＧＥＳ",
            "All pages.", "all-pages", "all__pages", "all–pages", ", all pages,; ", "allpages", "allslides",
        ):
            with self.subTest(expression=expression):
                self.assertEqual(selected_pages(expression, 5), list(range(5)))

    def test_all_selection_of_empty_material_is_empty(self):
        for expression in ("", "All pages", "all slides", "*"):
            with self.subTest(expression=expression):
                self.assertEqual(selected_pages(expression, 0), [])

    def test_numeric_ranges_remain_sorted_unique_and_zero_based(self):
        self.assertEqual(selected_pages("1-3, 5, 3-4, 2", 8), [0, 1, 2, 3, 4])
        self.assertEqual(selected_pages("8, 2, 6", 8), [1, 5, 7])

    def test_common_range_formatting_is_accepted(self):
        cases = {
            "1–3, 5": [0, 1, 2, 4],
            "1—3; 5": [0, 1, 2, 4],
            "1−3\n5": [0, 1, 2, 4],
            "1‑3, 5": [0, 1, 2, 4],
            "１－３，５": [0, 1, 2, 4],
            "Pages 1 to 3; page 5": [0, 1, 2, 4],
            "slides 1 TO 3; slide 5": [0, 1, 2, 4],
            "p. 1, pp. 3–4": [0, 2, 3],
            "1,,2; ;3,": [0, 1, 2],
            " 2 \u00a0–\u00a0 4 ": [1, 2, 3],
        }
        for expression, expected in cases.items():
            with self.subTest(expression=expression):
                self.assertEqual(selected_pages(expression, 5), expected)

    def test_ambiguous_or_invalid_words_never_widen_selection(self):
        for expression in (
            "some pages", "all except 1", "all pages except 1", "all, 1", "1, all",
            "all pages 1-3", "1-3, nonsense", "1/3", "1.5", "1-2-3", "-1", ",;\n,",
            ".", ",", None, 123,
        ):
            with self.subTest(expression=expression):
                with self.assertRaises(ValueError):
                    selected_pages(expression, 5)

    def test_out_of_bounds_and_reversed_ranges_still_fail(self):
        for expression in ("0", "0-2", "3-1", "1-6", "6", "2–9"):
            with self.subTest(expression=expression):
                with self.assertRaisesRegex(ValueError, "between 1 and 5"):
                    selected_pages(expression, 5)


class ExtractionScopeTests(unittest.TestCase):
    def test_pdf_all_pages_reaches_last_page_and_numeric_scope_stays_narrow(self):
        with patch.object(main, "PdfReader", side_effect=lambda _: fake_pdf()):
            text, labels = main.extract_material("biology.pdf", b"fake-pdf", " All pages ")
            self.assertEqual(labels, ["PDF page 1", "PDF page 2", "PDF page 3"])
            self.assertIn(PAGE_TEXT[-1], text)
            scoped, labels = main.extract_material("biology.pdf", b"fake-pdf", "Pages 2–3")
            self.assertEqual(labels, ["PDF page 2", "PDF page 3"])
            self.assertNotIn(PAGE_TEXT[0], scoped)

    def test_real_powerpoint_all_pages_and_all_slides_select_every_slide(self):
        raw = slide_bytes()
        for expression in ("All pages", "ALL SLIDES", "entire presentation"):
            with self.subTest(expression=expression):
                text, labels = main.extract_material("biology.pptx", raw, expression)
                self.assertEqual(labels, ["PowerPoint slide 1", "PowerPoint slide 2", "PowerPoint slide 3"])
                self.assertIn(PAGE_TEXT[-1], text)
        text, labels = main.extract_material("biology.pptx", raw, "slides 2 to 3")
        self.assertEqual(labels, ["PowerPoint slide 2", "PowerPoint slide 3"])
        self.assertNotIn(PAGE_TEXT[0], text)

    def test_direct_pdf_link_uses_the_same_fault_tolerant_selector(self):
        url = "https://materials.example.edu/biology.pdf"
        with patch.object(main, "_fetch_public_material_url", return_value=(b"fake-pdf", url, "application/pdf")), patch.object(main, "PdfReader", side_effect=lambda _: fake_pdf()):
            result = main.extract_public_material_url(url, "All pages")
            self.assertEqual(result[1], ["PDF page 1", "PDF page 2", "PDF page 3"])
            self.assertIn(PAGE_TEXT[-1], result[0])
            selected = main.extract_public_material_url(url, "2–3")
            self.assertEqual(selected[1], ["PDF page 2", "PDF page 3"])
            self.assertNotIn(PAGE_TEXT[0], selected[0])

    def test_invalid_selection_returns_actionable_422(self):
        with patch.object(main, "PdfReader", side_effect=lambda _: fake_pdf()):
            with self.assertRaises(HTTPException) as caught:
                main.extract_material("biology.pdf", b"fake-pdf", "all except 1")
            self.assertEqual(caught.exception.status_code, 422)
            self.assertIn("page", caught.exception.detail.lower())


class GenerationScopeTests(unittest.TestCase):
    setUp = fixtures.GenerationLimitTests.setUp
    provide = fixtures.GenerationLimitTests.provide
    update = fixtures.GenerationLimitTests.update

    def test_all_pages_survives_uploaded_pdf_and_background_job_routes(self):
        for route in ("/api/generate", "/api/generation-jobs"):
            with self.subTest(route=route), patch.object(main, "PdfReader", side_effect=lambda _: fake_pdf()):
                response = self.client.post(route, data={"format": "flashcards", "question_count": "1", "page_ranges": json.dumps({"0": "All pages"})}, files={"files": ("biology.pdf", b"fake-pdf", "application/pdf")})
                self.assertEqual(response.status_code, 202 if route.endswith("jobs") else 200, response.text)
                result = response.json()
                if route.endswith("jobs"):
                    job = self.client.get(f"/api/generation-jobs/{result['job_id']}").json()
                    self.assertEqual(job["status"], "complete", job)
                    result = job["result"]
                self.assertEqual(len(result["items"]), 1)
                self.assertIn(PAGE_TEXT[-1], self.provider.call_args.args[3])
                self.assertIn("biology.pdf · PDF page 3", self.provider.call_args.args[3])

    def test_invalid_ranges_stop_before_provider_calls_on_both_routes(self):
        for route in ("/api/generate", "/api/generation-jobs"):
            with self.subTest(route=route), patch.object(main, "PdfReader", side_effect=lambda _: fake_pdf()):
                response = self.client.post(route, data={"format": "flashcards", "question_count": "1", "page_ranges": json.dumps({"0": "all except 1"})}, files={"files": ("biology.pdf", b"fake-pdf", "application/pdf")})
                if route.endswith("jobs"):
                    self.assertEqual(response.status_code, 202)
                    job = self.client.get(f"/api/generation-jobs/{response.json()['job_id']}").json()
                    self.assertEqual(job["status"], "error")
                    self.assertEqual(job["error_status"], 422)
                else:
                    self.assertEqual(response.status_code, 422)
        self.provider.assert_not_called()


if __name__ == "__main__":
    unittest.main()
