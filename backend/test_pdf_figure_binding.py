"""Layout regressions use synthetic native PDFs, not private textbook assets."""
import base64
import unittest
from io import BytesIO
from unittest.mock import patch

from PIL import Image
from pypdf import PdfReader, PdfWriter
from pypdf.generic import (DecodedStreamObject, DictionaryObject, NameObject,
                           NumberObject)

from pdf_questionnaire import extract_pdf_questionnaire
from questionnaire import parse_questionnaire


def native_pdf(pages):
    """Preserve declared text/image object order independently of page layout."""
    writer = PdfWriter()
    font = writer._add_object(DictionaryObject({
        NameObject("/Type"): NameObject("/Font"),
        NameObject("/Subtype"): NameObject("/Type1"),
        NameObject("/BaseFont"): NameObject("/Helvetica"),
    }))
    for spec in pages:
        page = writer.add_blank_page(width=600, height=800)
        images = DictionaryObject()
        commands = []
        for x, y, text in spec.get("text", []):
            text = text.replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")
            commands.append(f"BT /F1 11 Tf {x} {y} Td ({text}) Tj ET")
        for ordinal, (x, y, width, height, color) in enumerate(spec.get("images", [])):
            image = Image.new("RGB", (100, 100), color)
            stream = DecodedStreamObject()
            stream.set_data(image.tobytes())
            image.close()
            stream.update({NameObject("/Type"): NameObject("/XObject"),
                           NameObject("/Subtype"): NameObject("/Image"),
                           NameObject("/Width"): NumberObject(100),
                           NameObject("/Height"): NumberObject(100),
                           NameObject("/ColorSpace"): NameObject("/DeviceRGB"),
                           NameObject("/BitsPerComponent"): NumberObject(8)})
            name = NameObject(f"/Img{ordinal}")
            images[name] = writer._add_object(stream)
            commands.append(f"q {width} 0 0 {height} {x} {y} cm {name} Do Q")
        page[NameObject("/Resources")] = DictionaryObject({
            NameObject("/Font"): DictionaryObject({NameObject("/F1"): font}),
            NameObject("/XObject"): images,
        })
        content = DecodedStreamObject()
        content.set_data("\n".join(commands).encode("ascii"))
        page[NameObject("/Contents")] = writer._add_object(content)
    output = BytesIO()
    writer.write(output)
    return output.getvalue()


def choices(x, y, first="First", second="Second"):
    return [(x, y, f"A. {first}"), (x, y-17, f"B. {second}"),
            (x, y-34, "Answer: A")]


def import_pdf(pages, indices=None):
    raw = native_pdf(pages)
    reader = PdfReader(BytesIO(raw))
    text, _labels = extract_pdf_questionnaire(raw, reader, indices or range(len(pages)))
    return parse_questionnaire([text])


def dominant_color(record):
    data = base64.b64decode(record["images"][0].split(",", 1)[1])
    with Image.open(BytesIO(data)) as image:
        color = image.convert("RGB").getpixel((50, 50))
    return max(range(3), key=color.__getitem__)


class PdfFigureBindingTests(unittest.TestCase):
    def test_cross_page_figure_and_next_question_keep_distinct_images_despite_object_order(self):
        records = import_pdf([
            {"text": [(50, 700, "1. Which isolate is shown in the image?")]
                      + choices(50, 675)
                      + [(50, 40, "42 CHAPTER 1 Microbiology")]},
            {"text": [(50, 510, "2. Which isolate is shown below?")]
                      + choices(50, 270)
                      + [(50, 180, "3. What is a culture?")]
                      + choices(50, 160)
                      # Captions are deliberately last in native text order.
                      + [(50, 300, "FIGURE 1-5"), (50, 560, "FIGURE 1-4")],
             # Image object order is the opposite of reading order.
             "images": [(50, 320, 160, 160, "blue"), (50, 580, 160, 160, "red")]},
        ])
        self.assertEqual([r.get("image_labels") for r in records],
                         [["Figure 1-4"], ["Figure 1-5"], None])
        self.assertEqual([dominant_color(r) for r in records[:2]], [0, 2])
        self.assertEqual(records[0]["source_refs"], ["PDF page 1", "PDF page 2"])
        self.assertEqual([r["answer"] for r in records], ["First"]*3)
        self.assertNotIn("CHAPTER", records[0]["options"][-1])

    def test_leading_figure_belongs_to_previous_visual_question_not_next_plain_question(self):
        records = import_pdf([
            {"text": [(50, 700, "1. The gram-stained smear shows which organism?")]
                      + choices(50, 670)
                      + [(50, 40, "CHAPTER 1 Microbiology 45")]},
            {"text": [(50, 520, "2. Which laboratory finding confirms colitis?")]
                      + choices(50, 490)
                      + [(50, 560, "FIGURE 1-7")],
             "images": [(50, 580, 160, 160, "red")]},
        ])
        self.assertEqual(records[0].get("image_labels"), ["Figure 1-7"])
        self.assertNotIn("images", records[1])
        self.assertEqual(records[1]["answer"], "First")

    def test_explicit_shown_above_overrides_previous_question_ownership(self):
        records = import_pdf([{
            "text": [(50, 750, "1. Which method is used?")] + choices(50, 730)
                    + [(50, 400, "2. What does the image shown above depict?")]
                    + choices(50, 380) + [(50, 450, "FIGURE 2-1")],
            "images": [(50, 470, 160, 160, "blue")],
        }])
        self.assertNotIn("images", records[0])
        self.assertEqual(records[1].get("image_labels"), ["Figure 2-1"])

    def test_explicit_figure_reference_overrides_nearest_question(self):
        records = import_pdf([{
            "text": [(50, 750, "1. Identify the structure in Figure 3-2.")]
                    + choices(50, 730)
                    + [(50, 620, "2. Which test is used?")]
                    + choices(50, 600) + [(50, 350, "FIGURE 3-2")],
            "images": [(50, 370, 160, 160, "red")],
        }])
        self.assertEqual(records[0].get("image_labels"), ["Figure 3-2"])
        self.assertNotIn("images", records[1])

    def test_visual_question_below_figure_wins_over_plain_question_above(self):
        records = import_pdf([{
            "text": [(50, 750, "1. Which method is used?")] + choices(50, 730)
                    + [(50, 400, "2. Identify the structure shown in the image.")]
                    + choices(50, 380) + [(50, 450, "FIGURE 2-1")],
            "images": [(50, 470, 160, 160, "blue")],
        }])
        self.assertNotIn("images", records[0])
        self.assertEqual(records[1].get("image_labels"), ["Figure 2-1"])

    def test_numeric_medical_continuation_near_page_edge_is_not_stripped(self):
        records = import_pdf([{
            "text": [(50, 150, "1. Which measurement is correct?"),
                     (50, 80, "A. Below"), (50, 40, "37 degrees Celsius"),
                     (50, 25, "B. Above"), (300, 25, "Answer: A")],
        }])
        self.assertEqual(records[0]["answer"], "Below\n37 degrees Celsius")

    def test_unreferenced_figure_between_plain_questions_is_not_guessed_onto_either(self):
        records = import_pdf([{
            "text": [(50, 750, "1. Which laboratory test is used?")]
                    + choices(50, 730)
                    + [(50, 400, "2. Which specimen should be collected?")]
                    + choices(50, 380) + [(50, 450, "FIGURE 2-1")],
            "images": [(50, 470, 160, 160, "blue")],
        }])
        self.assertTrue(all(not record.get("images") for record in records))

    def test_deictic_description_and_observational_stems_keep_their_relevant_figures(self):
        for stem in ("The appearance of this specimen would best be described how?",
                     "The following were observed. Which outcome is correct?",
                     "A Gram stain was performed. Which morphology was seen?"):
            with self.subTest(stem=stem):
                records = import_pdf([{
                    "text": [(50, 750, "1. " + stem)] + choices(50, 470)
                            + [(50, 520, "FIGURE 2-1")],
                    "images": [(50, 540, 160, 160, "blue")],
                }])
                self.assertEqual(records[0].get("image_labels"), ["Figure 2-1"])

    def test_column_geometry_keeps_each_figure_with_its_question(self):
        records = import_pdf([{
            "text": [(50, 750, "1. Which red structure is shown?")]
                    + choices(50, 490)
                    + [(330, 750, "2. Which blue structure is shown?")]
                    + choices(330, 490)
                    + [(330, 520, "FIGURE 4-2"), (50, 520, "FIGURE 4-1")],
            "images": [(330, 540, 160, 160, "blue"), (50, 540, 160, 160, "red")],
        }])
        self.assertEqual([r["image_labels"] for r in records],
                         [["Figure 4-1"], ["Figure 4-2"]])
        self.assertEqual([dominant_color(r) for r in records], [0, 2])

    def test_noncontiguous_selection_does_not_attach_orphan_from_an_unselected_question(self):
        pages = [
            {"text": [(50, 750, "1. Which image is shown?")] + choices(50, 730)},
            {"text": [(50, 750, "2. Omitted source question?")] + choices(50, 730)},
            {"text": [(50, 510, "3. Which structure is shown below?")]
                      + choices(50, 250)
                      + [(50, 550, "FIGURE 5-1"), (50, 290, "FIGURE 5-2")],
             "images": [(50, 570, 160, 160, "red"), (50, 310, 160, 160, "blue")]},
        ]
        records = import_pdf(pages, [0, 2])
        self.assertNotIn("images", records[0])
        self.assertEqual(records[1].get("image_labels"), ["Figure 5-2"])
        self.assertEqual(dominant_color(records[1]), 2)

    def test_native_figure_only_continuation_page_does_not_require_ocr(self):
        with patch("pdf_questionnaire.ocr_questionnaire_image", side_effect=AssertionError("Native figure is readable")):
            records = import_pdf([
                {"text": [(50, 700, "1. Identify the structure shown in the image.")]
                          + choices(50, 670)},
                {"text": [(50, 450, "FIGURE 6-1")],
                 "images": [(50, 470, 160, 160, "blue")]},
            ])
        self.assertEqual(records[0].get("image_labels"), ["Figure 6-1"])
        self.assertEqual(records[0]["source_refs"], ["PDF page 1", "PDF page 2"])

    def test_owner_survives_page_containing_only_its_continuing_choices(self):
        records = import_pdf([
            {"text": [(50, 700, "1. Identify the structure shown in the image."),
                      (50, 670, "A. First choice has a lengthy description which continues") ]},
            {"text": [(50, 700, "onto a second page with further explanatory details."),
                      (50, 670, "B. Second choice"), (50, 640, "Answer: A")]},
            {"text": [(50, 450, "FIGURE 6-2")],
             "images": [(50, 470, 160, 160, "blue")]},
        ])
        self.assertEqual(records[0].get("image_labels"), ["Figure 6-2"])
        self.assertEqual(set(records[0]["source_refs"]), {"PDF page 1", "PDF page 2", "PDF page 3"})


if __name__ == "__main__":
    unittest.main()
