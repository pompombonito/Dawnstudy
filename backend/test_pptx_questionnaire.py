"""Slide questionnaire layouts and native pictures, entirely synthetic."""
from io import BytesIO
import unittest

from PIL import Image
from pptx import Presentation
from pptx.util import Inches

from pptx_questionnaire import extract_pptx_questionnaire
from questionnaire import parse_questionnaire, QuestionnaireError
from test_generation_limits import main


def textbox(slide, text, left, top, width=4, height=2):
    shape = slide.shapes.add_textbox(Inches(left), Inches(top), Inches(width), Inches(height))
    shape.text = text
    return shape


def picture(slide, color, left, top, width=1, height=1):
    stream = BytesIO()
    Image.new("RGB", (100, 100), color).save(stream, "PNG")
    stream.seek(0)
    return slide.shapes.add_picture(stream, Inches(left), Inches(top), Inches(width), Inches(height))


class SlideQuestionnaireTests(unittest.TestCase):
    def test_reverse_object_order_columns_keep_each_question_and_its_picture(self):
        presentation = Presentation()
        presentation.slide_width = Inches(10)
        slide = presentation.slides.add_slide(presentation.slide_layouts[6])
        # Shapes were authored right first; visible reading order remains left.
        textbox(slide, "2. Identify the second image.\nA. Red\nB. Blue\nAnswer: B\nExplanation: The second image has a blue fill.", 5.2, .5)
        picture(slide, "blue", 5.3, 2.8)
        textbox(slide, "1. Identify the first image.\nE. Red\nF. Blue\nAnswer: E\nRationale: The first image has a red fill.", .3, .5)
        picture(slide, "red", .4, 2.8)
        text, labels = extract_pptx_questionnaire(presentation, [0])
        records = parse_questionnaire([text])
        self.assertEqual([record["source_number"] for record in records], ["1", "2"])
        self.assertEqual([record["answer"] for record in records], ["Red", "Blue"])
        self.assertEqual([len(record["images"]) for record in records], [1, 1])
        self.assertNotEqual(records[0]["images"], records[1]["images"])
        self.assertEqual(records[0]["labels"], ["E", "F"])
        self.assertEqual(records[0]["explanation"], "The first image has a red fill.")
        self.assertEqual(labels, ["PowerPoint slide 1"])

    def test_question_table_preserves_choices_key_and_explanation(self):
        presentation = Presentation()
        slide = presentation.slides.add_slide(presentation.slide_layouts[6])
        table = slide.shapes.add_table(2, 5, Inches(.5), Inches(.5), Inches(8), Inches(3)).table
        for column, value in enumerate(["Question", "A", "B", "Answer", "Rationale"]):
            table.cell(0, column).text = value
        for column, value in enumerate(["Which value is first?", "Alpha", "Beta", "A", "Alpha is the first entry in this sequence."]):
            table.cell(1, column).text = value
        records = parse_questionnaire([extract_pptx_questionnaire(presentation, [0])[0]])
        self.assertEqual(records[0]["answer"], "Alpha")
        self.assertEqual(records[0]["explanation_origin"], "provided")
        self.assertEqual(records[0]["options"], ["Alpha", "Beta"])

    def test_slide_scope_and_actual_upload_extractor_keep_native_image(self):
        presentation = Presentation()
        for i, color in enumerate(("red", "blue"), 1):
            slide = presentation.slides.add_slide(presentation.slide_layouts[6])
            textbox(slide, f"{i}. Identify the image.\nAnswer: {color}\nExplanation: The visible color is {color}.", .5, .5)
            picture(slide, color, .5, 3)
        stream = BytesIO()
        presentation.save(stream)
        text, labels = main.extract_material("source.pptx", stream.getvalue(), "2", questionnaire=True)
        records = parse_questionnaire([text])
        self.assertEqual(len(records), 1)
        self.assertEqual(records[0]["source_number"], "2")
        self.assertEqual(records[0]["answer"], "blue")
        self.assertEqual(len(records[0]["images"]), 1)
        self.assertEqual(labels, ["PowerPoint slide 2"])

    def test_ambiguous_picture_between_multiple_questions_is_an_explicit_layout_error(self):
        presentation = Presentation()
        slide = presentation.slides.add_slide(presentation.slide_layouts[6])
        textbox(slide, "1. Identify the image.\nAnswer: Alpha\n2. Identify the image.\nAnswer: Beta", .5, .5)
        picture(slide, "red", .5, 3)
        with self.assertRaisesRegex(QuestionnaireError, "several questions"):
            extract_pptx_questionnaire(presentation, [0])


if __name__ == "__main__":
    unittest.main()
