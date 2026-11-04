import unittest
from io import BytesIO
from unittest.mock import patch, Mock
from PIL import Image, ImageDraw
from pypdf import PdfWriter, PdfReader
from pypdf.generic import NameObject, DictionaryObject, ArrayObject, FloatObject, DecodedStreamObject
from questionnaire import parse_questionnaire, convert_questionnaire, validate_completion, QuestionnaireError
from questionnaire_ocr import prepare_questionnaire_image, questionnaire_text_from_tsv
from pdf_questionnaire import extract_pdf_questionnaire
from test_generation_limits import main
from fastapi.testclient import TestClient


def highlighted_pdf(two_highlights=False):
    writer = PdfWriter()
    page = writer.add_blank_page(width=600, height=800)
    font = writer._add_object(DictionaryObject({NameObject("/Type"): NameObject("/Font"), NameObject("/Subtype"): NameObject("/Type1"), NameObject("/BaseFont"): NameObject("/Helvetica")}))
    page[NameObject("/Resources")] = DictionaryObject({NameObject("/Font"): DictionaryObject({NameObject("/F1"): font})})
    stream = DecodedStreamObject()
    stream.set_data(b"\n".join(f"BT /F1 12 Tf {x} {y} Td ({text}) Tj ET".encode() for x, y, text in [
        (50, 750, "1. Which option was marked?"), (50, 730, "a. First"), (260, 730, "c. Third"), (50, 710, "b. Second"), (260, 710, "d. Fourth"),
        (50, 670, "2. Which option is next?"), (50, 650, "a. Alpha"), (260, 650, "c. Gamma"), (50, 630, "b. Beta"), (260, 630, "d. Delta"),
    ]))
    page[NameObject("/Contents")] = writer._add_object(stream)
    boxes = [(260, 728, 330, 743), (50, 628, 110, 643)]
    if two_highlights:
        boxes.append((50, 708, 130, 723))
    annotations = []
    for left, bottom, right, top in boxes:
        quad = [left, top, right, top, left, bottom, right, bottom]
        annotations.append(writer._add_object(DictionaryObject({NameObject("/Type"): NameObject("/Annot"), NameObject("/Subtype"): NameObject("/Highlight"), NameObject("/Rect"): ArrayObject([FloatObject(v) for v in (left, bottom, right, top)]), NameObject("/QuadPoints"): ArrayObject([FloatObject(v) for v in quad]), NameObject("/C"): ArrayObject([FloatObject(1), FloatObject(1), FloatObject(0)])})))
    page[NameObject("/Annots")] = ArrayObject(annotations)
    result = BytesIO()
    writer.write(result)
    return result.getvalue()


def flattened_highlighted_pdf():
    """A text PDF whose green answer marks are page artwork, not annotations."""
    writer = PdfWriter()
    page = writer.add_blank_page(width=600, height=800)
    font = writer._add_object(DictionaryObject({NameObject("/Type"): NameObject("/Font"), NameObject("/Subtype"): NameObject("/Type1"), NameObject("/BaseFont"): NameObject("/Helvetica")}))
    page[NameObject("/Resources")] = DictionaryObject({NameObject("/Font"): DictionaryObject({NameObject("/F1"): font})})
    stream = DecodedStreamObject()
    lines = [
        (50, 750, "1. Which option was marked?"), (50, 730, "a. First"), (260, 730, "c. Third"), (50, 710, "b. Second"), (260, 710, "d. Fourth"),
        (50, 670, "2. Which option is next?"), (50, 650, "a. Alpha"), (260, 650, "c. Gamma"), (50, 630, "b. Beta"), (260, 630, "d. Delta"),
    ]
    text_content = b"\n".join(f"BT /F1 12 Tf {x} {y} Td ({text}) Tj ET".encode() for x, y, text in lines)
    marks = b"q 0.84 1 0.5 rg 258 727 76 16 re f Q\nq 1 0.88 0.52 rg 48 627 68 16 re f Q\n"
    stream.set_data(marks + text_content)
    page[NameObject("/Contents")] = writer._add_object(stream)
    result = BytesIO()
    writer.write(result)
    return result.getvalue()


class QuestionnaireLayoutTests(unittest.TestCase):
    def test_questionnaire_text_keeps_c_difficile_and_consecutive_choices(self):
        record = parse_questionnaire(["79. Which organism is isolated?\na. One\nb. Isolation of C. difficile from stool\nc. Three\nd. Four\nAnswer: B"])[0]
        self.assertEqual(record["labels"], ["A", "B", "C", "D"])
        self.assertEqual(record["options"][1], "Isolation of C. difficile from stool")
        self.assertEqual(record["answer"], "Isolation of C. difficile from stool")

    def test_numeric_lines_inside_questions_or_choices_are_not_new_questions(self):
        records = parse_questionnaire(["1. What does the Tween\n80 test measure?\na. A method using Tween\n80 from the reagent\nb. Another method\n2. Next question?\nAnswer: Done"])
        self.assertEqual(len(records), 2)
        self.assertIn("Tween\n80 test", records[0]["question"])
        self.assertEqual(records[0]["options"][0], "A method using Tween\n80 from the reagent")

    def test_page_break_choices_and_pdf_figure_marker_are_preserved(self):
        image = "data:image/webp;base64,AA=="
        source = f"9. Which structure is shown?\na. First\nb. Second\n[SOURCE: PDF page 2]\n[PDF_IMAGE: {image}]\nc. Third\nd. Fourth\nAnswer: C"
        record = parse_questionnaire([source])[0]
        self.assertEqual(record["labels"], ["A", "B", "C", "D"])
        self.assertEqual(record["source_refs"], ["PDF page 2"])
        for quiz_format in ("flashcards", "multiple_choice", "identification", "same_as_source"):
            with self.subTest(quiz_format=quiz_format):
                item = convert_questionnaire([record], quiz_format, {})[0]
                self.assertEqual(item["images"], [image])
                self.assertEqual(item["answer"], "Third")

    def test_same_as_source_keeps_matching_prompts_and_verified_pairs(self):
        record = parse_questionnaire(["1. Match each term to its description\n__First term\n__Second term\nA. First description\nB. Second description"])[0]
        payload = {"items": [{"number": "1", "question": record["question"], "answer": "Completed matching question", "uncertain": False, "distractors": [], "matching_pairs": [
            {"prompt": "First term", "match": "A"}, {"prompt": "Second term", "match": "B"},
        ]}]}
        completion = validate_completion([record], payload, False)
        item = convert_questionnaire([record], "same_as_source", completion)[0]
        self.assertEqual(item["quiz_type"], "matching")
        self.assertEqual(item["matching_prompts"], ["First term", "Second term"])
        self.assertEqual(item["matching_pairs"][0]["answer"], "First description")

    def test_two_columns_are_reordered_by_label_without_changing_answer(self):
        source = "1. Original stem?\na. First c. Third\nb. Second d. Fourth\nAnswer: c"
        record = parse_questionnaire([source])[0]
        self.assertEqual(record["options"], ["First", "Second", "Third", "Fourth"])
        self.assertEqual(record["answer"], "Third")
        self.assertEqual(convert_questionnaire([record], "flashcards", {})[0]["answer"], "Third")

    def test_missing_and_duplicate_labels_still_fail(self):
        for source in ("1. Question?\na. First\nc. Third", "1. Question?\na. First\nb. Second\na. Duplicate"):
            with self.subTest(source=source), self.assertRaises(QuestionnaireError):
                parse_questionnaire([source])

    def test_commentary_does_not_become_an_option_or_answer(self):
        source = "1. Question?\na. First c. Third\nAnswer: C\nb. Second d. Fourth\n- personal commentary\ncontinued commentary\n2. Next?\nAnswer: Next"
        records = parse_questionnaire([source])
        self.assertEqual(records[0]["options"][-1], "Fourth")
        self.assertEqual(records[0]["answer"], "Third")

    def test_image_highlighter_removed_and_its_answer_retained(self):
        image = Image.new("RGB", (400, 200), "white")
        ImageDraw.Draw(image).rectangle((250, 30, 350, 45), fill="yellow")
        clean, mask = prepare_questionnaire_image(image)
        self.assertEqual(clean.getpixel((520, 70)), (255, 255, 255))
        self.assertEqual(mask.getpixel((520, 70)), 255)
        rows = ["level\tpage_num\tblock_num\tpar_num\tline_num\tword_num\tleft\ttop\twidth\theight\tconf\ttext"]
        for line, words in enumerate([
            [(20, 20, "1. Question?", 160)],
            [(40, 64, "a.", 20), (70, 64, "First", 100), (510, 64, "c.", 20), (540, 64, "Third", 100)],
            [(40, 100, "b.", 20), (70, 100, "Second", 100), (510, 100, "d.", 20), (540, 100, "Fourth", 100)],
        ], 1):
            for i, (left, top, text, width) in enumerate(words, 1):
                rows.append(f"5\t1\t1\t1\t{line}\t{i}\t{left}\t{top}\t{width}\t16\t95\t{text}")
        text = questionnaire_text_from_tsv("\n".join(rows), mask)
        record = parse_questionnaire([text])[0]
        self.assertEqual(record["answer"], "Third")
        self.assertEqual(record["options"], ["First", "Second", "Third", "Fourth"])

    def test_native_pdf_highlights_and_two_columns_are_preserved(self):
        raw = highlighted_pdf()
        text, labels = extract_pdf_questionnaire(raw, PdfReader(BytesIO(raw)), [0])
        records = parse_questionnaire([text])
        self.assertEqual(labels, ["PDF page 1"])
        self.assertEqual([record["answer"] for record in records], ["Third", "Beta"])
        self.assertEqual(records[0]["options"], ["First", "Second", "Third", "Fourth"])
        self.assertEqual(main.extract_material("marked.pdf", raw, questionnaire=True)[0], text)

    def test_flattened_page_art_highlights_are_used_as_answer_keys(self):
        raw = flattened_highlighted_pdf()
        reader = PdfReader(BytesIO(raw))
        self.assertFalse(any(page.get("/Annots") for page in reader.pages))
        text, _labels = extract_pdf_questionnaire(raw, reader, [0])
        records = parse_questionnaire([text])
        self.assertEqual([record["answer"] for record in records], ["Third", "Beta"])
        self.assertTrue(all(record["answer"] in record["options"] for record in records))

    def test_native_pdf_import_uses_highlights_without_ai(self):
        user = {"user_id": "pdf-student", "email": "student@gmail.com"}
        main.app.dependency_overrides[main.onboarded_user] = lambda: user
        try:
            with patch.object(main, "generate_with_provider", side_effect=AssertionError("Provided highlighted answers must not be inferred")):
                response = TestClient(main.app).post("/api/generate", data={"format": "multiple_choice", "input_mode": "questionnaire"}, files={"files": ("marked.pdf", highlighted_pdf(), "application/pdf")})
            self.assertEqual(response.status_code, 200, response.text)
            self.assertEqual([item["answer"] for item in response.json()["items"]], ["Third", "Beta"])
            self.assertTrue(all(item["answer_origin"] == "provided" for item in response.json()["items"]))
        finally:
            main.app.dependency_overrides.clear()

    def test_multiple_highlighted_pdf_answers_are_not_guessed(self):
        raw = highlighted_pdf(two_highlights=True)
        with self.assertRaisesRegex(QuestionnaireError, "multiple highlighted"):
            extract_pdf_questionnaire(raw, PdfReader(BytesIO(raw)), [0])


if __name__ == "__main__":
    unittest.main()
