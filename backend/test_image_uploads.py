"""Common raster image formats stay readable in both import modes."""
import unittest
from io import BytesIO
from unittest.mock import patch

from PIL import Image

import test_generation_limits as fixtures

main = fixtures.main


def raster_bytes(format_name):
    image = Image.new("RGB", (80, 60), "white")
    output = BytesIO()
    image.save(output, format=format_name)
    image.close()
    return output.getvalue()


class ImageUploadTests(unittest.TestCase):
    def test_raster_notes_keep_ocr_and_contextual_figures_when_enabled(self):
        data_url = "data:image/webp;base64,dGVzdA=="
        extracted = [{"data_url": data_url, "context": "Labelled cell diagram"}]
        for extension, image_format in (("png", "PNG"), ("jpg", "JPEG"), ("webp", "WEBP"),
                                        ("bmp", "BMP"), ("gif", "GIF"), ("tif", "TIFF"), ("tiff", "TIFF")):
            with self.subTest(extension=extension):
                figures = []
                with patch.object(main, "ocr_learning_image", return_value=("Cell structure includes a nucleus and membrane.", extracted)) as ocr:
                    text, labels = main.extract_material(f"lesson.{extension}", raster_bytes(image_format), include_images=True, extracted_figures=figures)
                self.assertIn("nucleus", text)
                self.assertEqual(labels, ["Uploaded image"])
                self.assertEqual(figures[0]["context"], "Labelled cell diagram")
                self.assertEqual(figures[0]["source_ref"], "Uploaded image")
                ocr.assert_called_once()
                self.assertTrue(ocr.call_args.kwargs["include_images"])

    def test_raster_notes_without_toggle_do_not_extract_or_attach_figures(self):
        figures = []
        with patch.object(main, "ocr_learning_image", return_value=("Readable notes about cell division.", [])) as ocr:
            main.extract_material("lesson.tiff", raster_bytes("TIFF"), extracted_figures=figures)
        self.assertEqual(figures, [])
        self.assertFalse(ocr.call_args.kwargs["include_images"])

    def test_questionnaire_image_preserves_questionnaire_ocr_markers(self):
        marker = "[PDF_IMAGE: data:image/webp;base64,dGVzdA==]"
        with patch.object(main, "ocr_questionnaire_image", return_value=f"1. Identify the labeled structure?\n{marker}") as ocr:
            text, labels = main.extract_material("scan.gif", raster_bytes("GIF"), questionnaire=True)
        self.assertIn(marker, text)
        self.assertEqual(labels, ["Uploaded image"])
        ocr.assert_called_once()

    def test_public_image_link_keeps_its_visual_when_the_toggle_is_enabled(self):
        url = "https://materials.example.edu/cell.png"
        data_url = "data:image/webp;base64,dGVzdA=="
        with patch.object(main, "_fetch_public_material_url", return_value=(raster_bytes("PNG"), url, "image/png")), \
             patch.object(main, "ocr_learning_image", return_value=("Cell structure includes a nucleus and membrane.", [{"data_url": data_url, "context": "Cell diagram"}])):
            result = main.extract_public_material_url(url, include_images=True)
        self.assertEqual(len(result[6]), 1)
        self.assertEqual(result[6][0]["context"], "Cell diagram")
        self.assertEqual(result[6][0]["source_ref"], "Uploaded image")

    def test_public_figure_source_reference_matches_qualified_text_sources(self):
        text, labels = main.qualify_source_labels("cell.png", "[SOURCE: Uploaded image]\nCell diagram", ["Uploaded image"])
        figure_source = f"cell.png · Uploaded image"
        self.assertIn(f"[SOURCE: {figure_source}]", text)
        self.assertIn(figure_source, labels)


if __name__ == "__main__":
    unittest.main()
