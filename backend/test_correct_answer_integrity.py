import unittest
from unittest.mock import patch

from test_generation_limits import main


class CorrectAnswerIntegrityTests(unittest.TestCase):
    def test_answer_matching_preserves_punctuation_that_distinguishes_options(self):
        options = ["C++", "C#", "Java", "Python"]
        self.assertEqual(main.answer_texts_for_options("C#", options), ["C#"])

    def test_conflicting_answer_fields_are_rejected_instead_of_overwritten(self):
        item = {
            "question": "Which language is intended?",
            "options": ["C++", "C#", "Java", "Python"],
            "answer": "C#",
            "correct_answer": "C++",
        }
        self.assertIsNone(main.normalize_choice_item(item, "multiple_choice"))

    def test_near_match_is_rejected_instead_of_changed_to_a_choice(self):
        options = ["Mitochondrion", "Nucleus", "Ribosome", "Chloroplast"]
        self.assertEqual(main.answer_texts_for_options("Mitochondria", options), [])
        item = {"options": options, "answer": "Mitochondria", "correct_answer": "Mitochondria"}
        self.assertIsNone(main.normalize_choice_item(item, "multiple_choice"))

    def test_answer_survives_option_randomization(self):
        item = {
            "question": "Which language is intended?",
            "options": ["C++", "C#", "Java", "Python"],
            "answer": "C#",
            "correct_answer": "C#",
        }
        with patch.object(main.random, "shuffle", side_effect=lambda values: values.reverse()):
            randomized = main.randomize_choice_options([item], "multiple_choice")[0]
        self.assertEqual(randomized["correct_answer"], "C#")
        self.assertIn(randomized["correct_answer"], randomized["options"])


if __name__ == "__main__":
    unittest.main()
