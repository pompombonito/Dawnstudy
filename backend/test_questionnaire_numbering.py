
import unittest
from io import BytesIO
from unittest.mock import patch

from pypdf import PdfReader, PdfWriter
from pypdf.generic import NameObject, ArrayObject, FloatObject

from questionnaire import (
    parse_questionnaire,
    validate_completion,
    QuestionnaireError,
)
from pdf_questionnaire import extract_pdf_questionnaire
from test_questionnaire_layout import highlighted_pdf
from test_generation_limits import main


class QuestionnaireNumberingTests(unittest.TestCase):

    def test_restarted_numbers_with_inline_keys_keep_both_answers(self):
        records = parse_questionnaire([
            "1. First section?\n"
            "Answer: Alpha\n"
            "2. Other?\n"
            "Answer: Beta\n"
            "1. Next section?\n"
            "Answer: Gamma"
        ])

        self.assertEqual(
            [item["number"] for item in records],
            ["1", "2", "3"]
        )
        self.assertEqual(
            [item["source_number"] for item in records],
            ["1", "2", "1"]
        )
        self.assertEqual(
            [item["answer"] for item in records],
            ["Alpha", "Beta", "Gamma"]
        )

    def test_files_with_their_own_keys_do_not_conflict(self):
        first = (
            "[SOURCE: first.txt · Document]\n"
            "1. First?\n"
            "A. Red\n"
            "B. Blue\n"
            "Answer key:\n"
            "1. A"
        )

        second = (
            "[SOURCE: second.txt · Document]\n"
            "1. Second?\n"
            "A. Small\n"
            "B. Large\n"
            "Answer key:\n"
            "1. B"
        )

        records = parse_questionnaire([first, second])

        self.assertEqual(
            [item["answer"] for item in records],
            ["Red", "Large"]
        )
        self.assertEqual(
            records[1]["source_refs"],
            ["second.txt · Document"]
        )

    def test_sections_with_their_own_keys_do_not_conflict(self):
        source = (
            "Part I: First\n"
            "1. First?\n"
            "A. Red\n"
            "B. Blue\n"
            "Answer key:\n"
            "1. A\n"
            "Part II: Second\n"
            "1. Second?\n"
            "A. Small\n"
            "B. Large\n"
            "Answer key:\n"
            "1. B"
        )

        records = parse_questionnaire([source])

        self.assertEqual(
            [item["answer"] for item in records],
            ["Red", "Large"]
        )

    def test_new_questions_after_keys_can_start_without_a_section_title(self):
        source = (
            "1. First?\n"
            "A. Red\n"
            "B. Blue\n"
            "Answer key:\n"
            "1. A\n"
            "1. Second?\n"
            "A. Small\n"
            "B. Large\n"
            "Answer key:\n"
            "1. B"
        )

        records = parse_questionnaire([source])

        self.assertEqual(
            [item["answer"] for item in records],
            ["Red", "Large"]
        )

    def test_ambiguous_separate_keys_never_overwrite_repeated_numbers(self):
        documents = [
            "1. First?\nA. Red\nB. Blue",
            "1. Second?\nA. Small\nB. Large",
            "Answer key:\n1. B",
        ]

        with self.assertRaisesRegex(
            QuestionnaireError,
            "could match multiple sections"
        ):
            parse_questionnaire(documents)

    def test_missing_answers_use_unique_model_ids(self):
        records = parse_questionnaire([
            "1. First?",
            "1. Second?"
        ])

        payload = {
            "items": [
                {
                    "number": item["number"],
                    "question": item["question"],
                    "answer": answer,
                    "uncertain": False,
                    "distractors": [],
                }
                for item, answer in zip(
                    records,
                    ["Alpha", "Beta"]
                )
            ]
        }

        complete = validate_completion(records, payload, False)

        self.assertEqual(
            complete["1"]["answer"],
            "Alpha"
        )
        self.assertEqual(
            complete["2"]["answer"],
            "Beta"
        )

    def test_pdf_pages_with_restarted_numbers_keep_local_highlights(self):
        writer = PdfWriter()

        first = highlighted_pdf()
        second = PdfReader(BytesIO(first))

        annotation = second.pages[0]["/Annots"][0].get_object()

        annotation[NameObject("/QuadPoints")] = ArrayObject([
            FloatObject(value)
            for value in [
                50, 743, 120, 743,
                50, 728, 120, 728
            ]
        ])

        writer.append(PdfReader(BytesIO(first)))
        writer.append(second)

        output = BytesIO()
        writer.write(output)

        raw = output.getvalue()

        text, labels = extract_pdf_questionnaire(
            raw,
            PdfReader(BytesIO(raw)),
            [0, 1]
        )

        records = parse_questionnaire([text])

        self.assertEqual(len(records), 4)

        self.assertEqual(
            [item["source_number"] for item in records],
            ["1", "2", "1", "2"]
        )

        self.assertEqual(
            [item["answer"] for item in records],
            ["Third", "Beta", "First", "Beta"]
        )

        self.assertEqual(
            records[2]["source_refs"],
            ["PDF page 2"]
        )

    def test_same_page_restarted_numbers_keep_different_highlights(self):
        writer = PdfWriter()
        reader = PdfReader(BytesIO(highlighted_pdf()))

        page = reader.pages[0]
        contents = page["/Contents"].get_object()

        contents.set_data(
            contents.get_data().replace(
                b"2. Which option is next?",
                b"1. Which option is next?"
            )
        )

        writer.add_page(page)

        output = BytesIO()
        writer.write(output)

        raw = output.getvalue()

        text, _ = extract_pdf_questionnaire(
            raw,
            PdfReader(BytesIO(raw)),
            [0]
        )

        records = parse_questionnaire([text])

        self.assertEqual(
            [item["source_number"] for item in records],
            ["1", "1"]
        )

        self.assertEqual(
            [item["answer"] for item in records],
            ["Third", "Beta"]
        )

    def test_import_route_does_not_need_ai_to_renumber_supplied_answers(self):
        from fastapi.testclient import TestClient

        user = {
            "user_id": "numbering-student",
            "email": "student@gmail.com"
        }

        main.app.dependency_overrides[
            main.onboarded_user
        ] = lambda: user

        try:
            with patch.object(
                main,
                "generate_with_provider",
                side_effect=AssertionError("Supplied keys need no AI")
            ):
                response = TestClient(main.app).post(
                    "/api/generate",
                    data={
                        "format": "flashcards",
                        "input_mode": "questionnaire",
                        "questionnaire_type_confirmed": "true",
                        "questionnaire_type_policy": "convert",
                    },
                    files=[
                        (
                            "files",
                            (
                                "first.txt",
                                b"1. First?\nAnswer: Alpha"
                            )
                        ),
                        (
                            "files",
                            (
                                "second.txt",
                                b"1. Second?\nAnswer: Beta"
                            )
                        ),
                    ]
                )

            self.assertEqual(
                response.status_code,
                200,
                response.text
            )

            self.assertEqual(
                [item["answer"] for item in response.json()["items"]],
                ["Alpha", "Beta"]
            )

        finally:
            main.app.dependency_overrides.clear()


if __name__ == "__main__":
    unittest.main()
