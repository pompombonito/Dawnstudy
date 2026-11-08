import unittest
from unittest.mock import patch

from questionnaire import QuestionnaireError, convert_questionnaire, parse_questionnaire, validate_completion
from test_generation_limits import main
import live_games


class QuestionnaireMixedAnswerTests(unittest.TestCase):
    def test_multiple_keys_keep_exact_choice_values_and_order(self):
        for key in ("A | C", "A, C", "C and A", "(A); (C)"):
            with self.subTest(key=key):
                source = f"1. Select the two correct values.\nA. C++\nB. C#\nC. A | B\nD. Other\nAnswer: {key}"
                record = parse_questionnaire([source])[0]
                self.assertEqual(record["correct_answers"], ["C++", "A | B"])
                item = convert_questionnaire([record], "same_as_source", {})[0]
                self.assertEqual(item["quiz_type"], "checkbox")
                self.assertEqual(item["correct_answers"], ["C++", "A | B"])
                self.assertEqual(item["options"], ["C++", "C#", "A | B", "Other"])
                self.assertTrue(live_games.correct_answer(item, "same_as_source", ["A | B", "C++"]))
                self.assertFalse(live_games.correct_answer(item, "same_as_source", ["C#", "A | B"]))
                with self.assertRaisesRegex(QuestionnaireError, "multiple correct answers"):
                    convert_questionnaire([record], "multiple_choice", {})

    def test_source_key_is_resolved_once_before_literal_letter_answer_is_saved(self):
        record = parse_questionnaire(["1. Which blood type?\nA. B\nB. A\nC. O\nAnswer: B"])[0]
        self.assertEqual(record["answer"], "A")
        self.assertEqual(record["correct_answers"], ["A"])

    def test_equivalent_inline_and_separate_multiple_keys_do_not_conflict(self):
        record = parse_questionnaire(["1. Select two.\nA. First\nB. Second\nC. Third\nAnswer: C, A\nAnswer key:\n1. A | C"])[0]
        self.assertEqual(record["correct_answers"], ["First", "Third"])

    def test_inferred_multiple_answers_are_allowed_only_for_checkbox_formats(self):
        record = parse_questionnaire(["1. Select all that apply.\nA. First\nB. Second\nC. Third"])[0]
        payload = {"items": [{"number": record["number"], "question": record["question"],
                              "answer": "First | Third", "uncertain": False, "distractors": []}]}
        for selected in ("checkbox", "same_as_source"):
            with self.subTest(selected=selected):
                completed = validate_completion([record], payload, selected)
                item = convert_questionnaire([record], selected, completed)[0]
                self.assertEqual(item["correct_answers"], ["First", "Third"])
                self.assertEqual(item["answer"], "First | Third")
                if selected == "same_as_source":
                    self.assertEqual(item["quiz_type"], "checkbox")
        with self.assertRaises(QuestionnaireError):
            validate_completion([record], payload, "multiple_choice")
        record["question"] = "Which one is correct?"
        record.pop("quiz_type", None)
        payload["items"][0]["question"] = record["question"]
        with self.assertRaises(QuestionnaireError):
            validate_completion([record], payload, "same_as_source")

    def test_supplied_matching_keys_are_used_verbatim_without_ai(self):
        for key in ("1-B; 2-A", "Second term: A; First term: B", "B, A"):
            with self.subTest(key=key):
                source = f"1. Match each term to its description.\n__First term\n__Second term\nA. First description\nB. Second description\nAnswer: {key}"
                with patch.object(main, "configured_ai_models", side_effect=AssertionError("A provided key must not require AI")):
                    items, _models, incomplete, requested, _unresolved = main.import_questionnaire([source], "same_as_source", "auto")
                self.assertEqual(requested, 1)
                self.assertFalse(incomplete)
                self.assertEqual(items[0]["answer_origin"], "provided")
                self.assertEqual(items[0]["matching_pairs"], [
                    {"prompt": "First term", "answer": "Second description"},
                    {"prompt": "Second term", "answer": "First description"},
                ])

    def test_incomplete_or_conflicting_matching_keys_are_rejected(self):
        base = "1. Match each term.\n__First term\n__Second term\nA. First description\nB. Second description\nAnswer: "
        for key in ("1-A", "1-A; 2-A", "1-A; 1-B", "1-C; 2-B"):
            with self.subTest(key=key), self.assertRaises(QuestionnaireError):
                parse_questionnaire([base + key])


if __name__ == "__main__":
    unittest.main()
