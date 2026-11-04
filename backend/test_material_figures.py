import base64
import unittest
from io import BytesIO

from PIL import Image, ImageDraw
from docx import Document
from docx.shared import Inches as DocxInches
from pptx import Presentation
from pptx.util import Inches

from material_figures import extract_embedded_figures


def diagram():
    image = Image.new("RGB", (200, 100), "white")
    draw = ImageDraw.Draw(image)
    draw.rectangle((0, 0, 99, 99), fill="red")
    draw.rectangle((100, 0, 199, 99), fill="blue")
    output = BytesIO()
    image.save(output, "PNG")
    return output.getvalue()


class EmbeddedFigureTests(unittest.TestCase):
    def test_pptx_figures_keep_slide_context_crop_and_ignore_tiny_decoration(self):
        presentation = Presentation()
        slide = presentation.slides.add_slide(presentation.slide_layouts[6])
        slide.shapes.add_textbox(Inches(1), Inches(.3), Inches(6), Inches(.7)).text = "The blue region identifies the cell nucleus."
        picture = slide.shapes.add_picture(BytesIO(diagram()), Inches(1), Inches(1.2), width=Inches(2), height=Inches(2))
        picture.crop_left = .5
        slide.shapes.add_picture(BytesIO(diagram()), Inches(5), Inches(1), width=Inches(.1), height=Inches(.1))
        output = BytesIO()
        presentation.save(output)
        figures = extract_embedded_figures("lecture.pptx", output.getvalue())
        self.assertEqual(len(figures), 1)
        self.assertEqual(figures[0]["source_ref"], "PowerPoint slide 1")
        self.assertIn("cell nucleus", figures[0]["context"])
        self.assertEqual(figures[0]["id"], "pptx-slide-1-figure-1")
        with Image.open(BytesIO(base64.b64decode(figures[0]["data_url"].split(",")[1]))) as image:
            self.assertEqual(image.size, (100, 100))
            red, green, blue = image.getpixel((50, 50))
            self.assertGreater(blue, red+100)

    def test_pptx_figure_selection_respects_selected_slide_numbers(self):
        presentation = Presentation()
        for label in ("First slide figure", "Second slide figure"):
            slide = presentation.slides.add_slide(presentation.slide_layouts[6])
            slide.shapes.add_textbox(Inches(1), Inches(.3), Inches(6), Inches(.7)).text = label
            slide.shapes.add_picture(BytesIO(diagram()), Inches(1), Inches(1.2), width=Inches(2), height=Inches(2))
        output = BytesIO()
        presentation.save(output)
        figures = extract_embedded_figures("lecture.pptx", output.getvalue(), [1])
        self.assertEqual(len(figures), 1)
        self.assertEqual(figures[0]["source_ref"], "PowerPoint slide 2")
        self.assertIn("Second slide figure", figures[0]["context"])

    def test_docx_figures_keep_nearby_paragraph_context_and_ignore_tiny_decoration(self):
        document = Document()
        document.add_paragraph("Mitosis illustration: identify the metaphase plate.")
        document.add_picture(BytesIO(diagram()), width=DocxInches(2))
        document.add_paragraph("Chromosomes line up at the center of the cell.")
        document.add_picture(BytesIO(diagram()), width=DocxInches(.1))
        output = BytesIO()
        document.save(output)
        figures = extract_embedded_figures("handout.DOCX", output.getvalue())
        self.assertEqual(len(figures), 1)
        self.assertEqual(figures[0]["source_ref"], "Document")
        self.assertEqual(figures[0]["id"], "docx-figure-1")
        self.assertIn("metaphase", figures[0]["context"])
        self.assertIn("Chromosomes line up", figures[0]["context"])
        with Image.open(BytesIO(base64.b64decode(figures[0]["data_url"].split(",")[1]))) as image:
            self.assertEqual(image.size, (200, 100))


if __name__ == "__main__":
    unittest.main()
