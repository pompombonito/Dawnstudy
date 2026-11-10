"""Word question-image ownership and source rationale preservation."""
from io import BytesIO
import unittest

from docx import Document
from docx.shared import Inches
from PIL import Image

from questionnaire import docx_questionnaire_text, parse_questionnaire
from test_generation_limits import main


def add_image(paragraph, color="red"):
    image = BytesIO()
    Image.new("RGB", (100, 100), color).save(image, "PNG")
    image.seek(0)
    paragraph.add_run().add_picture(image, width=Inches(.7))


class WordImageTests(unittest.TestCase):
    def test_native_inline_picture_belongs_to_its_question_only(self):
        document = Document()
        paragraph = document.add_paragraph("1. Identify the color shown.")
        add_image(paragraph)
        document.add_paragraph("A. Red\nB. Blue\nAnswer: A\nRationale: The visible color is red.")
        document.add_paragraph("2. Name the unit.\nAnswer: Joule\nExplanation: A joule is the named unit.")
        records = parse_questionnaire([docx_questionnaire_text(document)])
        self.assertEqual(records[0]["question"], "Identify the color shown.")
        self.assertEqual(records[0]["answer"], "Red")
        self.assertEqual(len(records[0]["images"]), 1)
        self.assertNotIn("images", records[1])
        self.assertEqual(records[0]["explanation"], "The visible color is red.")

    def test_question_cell_image_does_not_move_into_answer_or_rationale(self):
        document = Document()
        table = document.add_table(rows=3, cols=3)
        for i, value in enumerate(("Question", "Answer", "Explanation")):
            table.cell(0, i).text = value
        table.cell(1, 0).text = "1. Identify this image."
        add_image(table.cell(1, 0).paragraphs[0], "blue")
        table.cell(1, 1).text = "Blue"
        table.cell(1, 2).text = "The image has a blue fill."
        table.cell(2, 0).text = "2. Which value follows Alpha?"
        table.cell(2, 1).text = "Beta"
        table.cell(2, 2).text = "Beta is the next entry."
        records = parse_questionnaire([docx_questionnaire_text(document)])
        self.assertEqual(len(records[0]["images"]), 1)
        self.assertNotIn("images", records[1])
        self.assertEqual(records[0]["answer"], "Blue")
        self.assertEqual(records[0]["explanation_origin"], "provided")

    def test_image_only_paragraph_between_stem_and_choices_survives_upload_route(self):
        document = Document()
        document.add_paragraph("1. Identify the diagram.")
        add_image(document.add_paragraph())
        document.add_paragraph("A. Alpha\nB. Beta\nAnswer: B\nExplanation: The source identifies Beta.")
        stream = BytesIO()
        document.save(stream)
        text, labels = main.extract_material("questions.docx", stream.getvalue(), questionnaire=True)
        records = parse_questionnaire([text])
        self.assertEqual(labels, ["Document"])
        self.assertEqual(records[0]["answer"], "Beta")
        self.assertEqual(len(records[0]["images"]), 1)
        self.assertEqual(records[0]["options"], ["Alpha", "Beta"])


if __name__ == "__main__":
    unittest.main()
