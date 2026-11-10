"""Source explanations stay distinct from exact questionnaire text and keys."""
import copy
import unittest

from docx import Document
from questionnaire import (QuestionnaireError, convert_questionnaire,
                           docx_questionnaire_text, parse_questionnaire,
                           questionnaire_item_explanation, validate_completion,
                           validate_completion_partial)


QUESTION = "1. Which pigment absorbs light?\nA. Chlorophyll\nB. Melanin\nC. Keratin\nD. Hemoglobin\nAnswer: A"
RATIONALE = "Chlorophyll absorbs light energy used during photosynthesis."


def completion(record, explanation=RATIONALE):
    return {"number": record["number"], "question": record["question"],
            "answer": record["answer"] or "Chlorophyll", "uncertain": False,
            "distractors": [], "matching_pairs": [], "explanation": explanation}


class SourceExplanationTests(unittest.TestCase):
    def test_recovered_page_highlight_does_not_turn_wrapped_choice_into_explanation(self):
        source = ("[SOURCE: PDF page 1]\n1. Which reaction applies?\nA. First\nB. Nitrate\n"
                  "[PDF_HIGHLIGHT_ANSWER: B]\n[SOURCE: PDF page 2]\nreduction\nC. Third\nD. Fourth")
        record = parse_questionnaire([source])[0]
        self.assertEqual(record["answer"], "Nitrate\nreduction")
        self.assertEqual(record["explanation"], "")
        self.assertEqual(record["options"], ["First", "Nitrate\nreduction", "Third", "Fourth"])

    def test_textbook_answers_and_rationales_headings_are_not_key_content(self):
        for heading in ("Answers and rationales:", "ANSWER AND EXPLANATION", "Answer key & explanations:", "Correct answers with rationales:"):
            with self.subTest(heading=heading):
                source = QUESTION.split("\nAnswer:")[0] + "\n" + heading + "\n1. A. " + RATIONALE
                record = parse_questionnaire([source])[0]
                self.assertEqual(record["answer"], "Chlorophyll")
                self.assertEqual(record["explanation"], RATIONALE)

    def test_unlabelled_prose_below_a_printed_choice_key_is_an_explanation(self):
        record = parse_questionnaire([QUESTION + "\n" + RATIONALE + "\nThe source also supplies a second line."])[0]
        self.assertEqual(record["answer"], "Chlorophyll")
        self.assertEqual(record["options"][-1], "Hemoglobin")
        self.assertEqual(record["explanation"], RATIONALE + "\nThe source also supplies a second line.")

    def test_explicit_explanation_headers_preserve_multiple_lines_and_choices(self):
        for label in ("Explanation", "Rationale", "Why", "Reason", "Justification",
                      "Solution", "SIDE NOTES", "NOTE", "Answer explanation", "**Rationale:**"):
            with self.subTest(label=label):
                header = label if label.endswith("**") else label + ":"
                source = QUESTION + "\n" + header + "\n" + RATIONALE + "\nIt occurs in chloroplast membranes."
                record = parse_questionnaire([source])[0]
                self.assertEqual(record["question"], "Which pigment absorbs light?")
                self.assertEqual(record["options"], ["Chlorophyll", "Melanin", "Keratin", "Hemoglobin"])
                self.assertEqual(record["answer"], "Chlorophyll")
                self.assertEqual(record["explanation"], RATIONALE + "\nIt occurs in chloroplast membranes.")
                self.assertEqual(record["explanation_origin"], "provided")

    def test_inline_answer_and_explanation_do_not_change_the_stem(self):
        record = parse_questionnaire(["1. Name the pigment. Answer: Chlorophyll Rationale: " + RATIONALE])[0]
        self.assertEqual(record["question"], "Name the pigment.")
        self.assertEqual(record["answer"], "Chlorophyll")
        self.assertEqual(record["explanation"], RATIONALE)

    def test_inline_choices_answer_and_explanation_stay_separate(self):
        source = "1. Which pigment absorbs light? A. Chlorophyll B. Melanin C. Keratin D. Hemoglobin Answer: A Explanation: " + RATIONALE
        record = parse_questionnaire([source])[0]
        self.assertEqual(record["options"], ["Chlorophyll", "Melanin", "Keratin", "Hemoglobin"])
        self.assertEqual(record["answer"], "Chlorophyll")
        self.assertEqual(record["explanation"], RATIONALE)

    def test_literal_explanation_words_in_stems_and_options_remain_source_text(self):
        source = ("1. Describe the rationale: its structure and purpose.\n"
                  "A. Rationale: a reason for an action\nB. Other description\nAnswer: A\nExplanation: The first choice supplies the requested meaning.")
        record = parse_questionnaire([source])[0]
        self.assertEqual(record["question"], "Describe the rationale: its structure and purpose.")
        self.assertEqual(record["options"][0], "Rationale: a reason for an action")
        self.assertEqual(record["answer"], "Rationale: a reason for an action")
        self.assertEqual(record["explanation"], "The first choice supplies the requested meaning.")

    def test_explanation_after_last_option_is_not_absorbed_into_it(self):
        source = QUESTION.replace("\nAnswer: A", " Rationale: " + RATIONALE + "\nAnswer: A")
        record = parse_questionnaire([source])[0]
        self.assertEqual(record["options"][-1], "Hemoglobin")
        self.assertEqual(record["explanation"], RATIONALE)

    def test_answer_key_explanations_are_associated_with_their_question(self):
        source = (QUESTION.split("\nAnswer:")[0] + "\n2. Name the energy unit.\n"
                  "Answer key:\n1. A Explanation: " + RATIONALE + "\nThis is the green pigment.\n"
                  "2. Joule\nRationale:\nThe joule is the SI unit of energy.\nIt is also used for work.")
        records = parse_questionnaire([source])
        self.assertEqual([record["answer"] for record in records], ["Chlorophyll", "Joule"])
        self.assertEqual(records[0]["explanation"], RATIONALE + "\nThis is the green pigment.")
        self.assertEqual(records[1]["explanation"], "The joule is the SI unit of energy.\nIt is also used for work.")

    def test_unlabelled_textbook_key_rationale_is_preserved(self):
        source = QUESTION.split("\nAnswer:")[0] + "\nAnswer key:\n1. a. " + RATIONALE + "\nIt occurs in chloroplast membranes."
        record = parse_questionnaire([source])[0]
        self.assertEqual(record["answer"], "Chlorophyll")
        self.assertEqual(record["explanation"], RATIONALE + "\nIt occurs in chloroplast membranes.")
        self.assertEqual(record["options"][-1], "Hemoglobin")

    def test_a_matching_labelled_option_key_is_not_mistaken_for_a_rationale(self):
        record = parse_questionnaire([QUESTION.split("\nAnswer:")[0] + "\nAnswer key:\n1. A. Chlorophyll"])[0]
        self.assertEqual(record["answer"], "Chlorophyll")
        self.assertEqual(record["explanation"], "")

    def test_docx_question_and_explanation_columns_preserve_wording_and_number(self):
        document = Document()
        table = document.add_table(rows=2, cols=6)
        for cell, text in zip(table.rows[0].cells, ["Question no.", "Question", "A", "B", "Correct answer", "Rationale"]):
            cell.text = text
        for cell, text in zip(table.rows[1].cells, ["07", "Which pigment absorbs light?", "Chlorophyll", "Melanin", "A", RATIONALE]):
            cell.text = text
        record = parse_questionnaire([docx_questionnaire_text(document)])[0]
        self.assertEqual(record["source_number"], "07")
        self.assertEqual(record["options"], ["Chlorophyll", "Melanin"])
        self.assertEqual(record["explanation"], RATIONALE)

    def test_docx_answer_key_explanation_columns_are_read_in_order(self):
        document = Document()
        for line in QUESTION.split("\nAnswer:")[0].splitlines():
            document.add_paragraph(line)
        table = document.add_table(rows=2, cols=3)
        for cell, text in zip(table.rows[0].cells, ["No.", "Answer", "Explanation"]):
            cell.text = text
        for cell, text in zip(table.rows[1].cells, ["1", "A", RATIONALE]):
            cell.text = text
        record = parse_questionnaire([docx_questionnaire_text(document)])[0]
        self.assertEqual(record["answer"], "Chlorophyll")
        self.assertEqual(record["explanation"], RATIONALE)

    def test_lecture_preface_is_excluded_only_before_an_explicit_test_section(self):
        source = ("[SOURCE: PDF page 1]\nLECTURE NOTES\n2. Inhalant allergens\n\u25cb House dust mites\n"
                  "1. MOSQUITOS\na. Vectors of malaria\n\u25a0 Anopheles\n"
                  "PARASITOLOGY TEST BY THE INSTRUCTOR\n" + QUESTION + "\nSIDE NOTES:\n" + RATIONALE)
        records = parse_questionnaire([source])
        self.assertEqual(len(records), 1)
        self.assertEqual(records[0]["question"], "Which pigment absorbs light?")
        self.assertEqual(records[0]["source_refs"], ["PDF page 1"])
        ordinary = parse_questionnaire(["1. Energy unit.\nAnswer: Joule\n2. Force unit.\nAnswer: Newton"])
        self.assertEqual([record["question"] for record in ordinary], ["Energy unit.", "Force unit."])

    def test_genuine_questions_before_a_test_heading_are_retained(self):
        source = "LECTURE NOTES\n\u25cb A reminder\n1. Define energy.\nAnswer: Capacity to do work\nPRACTICE TEST BY THE INSTRUCTOR\n2. Name the energy unit.\nAnswer: Joule"
        records = parse_questionnaire([source])
        self.assertEqual(len(records), 2)
        self.assertEqual(records[0]["answer"], "Capacity to do work")

    def test_numbered_side_note_list_is_not_imported_as_additional_questions(self):
        source = ("27. Which tapeworm causes cysticercosis?\nA. Taenia solium\nB. Other\nSIDE NOTES:\n"
                  "Two points apply.\nAnswer: A\n1. Taenia solium\n2. Cysticercosis\n"
                  "\u2605 Larvae can form cysts in tissues.\n28. Name the energy unit.\nAnswer: Joule")
        records = parse_questionnaire([source])
        self.assertEqual(len(records), 2)
        self.assertEqual(records[0]["answer"], "Taenia solium")
        self.assertIn("1. Taenia solium\n2. Cysticercosis", records[0]["explanation"])

    def test_genus_initial_is_not_split_into_an_empty_option(self):
        record = parse_questionnaire(["1. Which organism?\nA. E. histolytica\nB. G. lamblia\nC. Other\nAnswer: A"])[0]
        self.assertEqual(record["options"], ["E. histolytica", "G. lamblia", "Other"])

    def test_contiguous_non_a_option_labels_remain_original(self):
        record = parse_questionnaire(["1. Which specimen?\nE. Urine\nF. Nail clippings\nG. Stool\nH. Sputum\nAnswer: F"])[0]
        item = convert_questionnaire([record], "same_as_source", {})[0]
        self.assertEqual(item["option_labels"], ["E", "F", "G", "H"])
        self.assertEqual(item["options"], ["Urine", "Nail clippings", "Stool", "Sputum"])
        self.assertEqual(item["answer"], "Nail clippings")
        existing = {**item, "card_id": "keep-this-id"}
        resumed = convert_questionnaire([record], "same_as_source", {}, existing_items=[existing])[0]
        self.assertEqual(resumed["option_labels"], item["option_labels"])
        self.assertEqual(resumed["card_id"], "keep-this-id")

    def test_resume_replaces_phantom_ocr_option_and_its_labels_together(self):
        record = parse_questionnaire(["1. Which language?\nE. C#\nF. C++\nG. Java\nAnswer: F\nExplanation: The source key selects C++."])[0]
        old = convert_questionnaire([record], "same_as_source", {})[0]
        old.update(options=["C#", "C++", "Java", "phantom"], option_labels=["A", "B", "C", "D"],
                   correct_answers=["phantom"], card_id="stable-review-id")
        item = convert_questionnaire([record], "same_as_source", {}, existing_items=[old])[0]
        self.assertEqual(item["options"], ["C#", "C++", "Java"])
        self.assertEqual(item["option_labels"], ["E", "F", "G"])
        self.assertEqual(item["correct_answers"], ["C++"])
        self.assertEqual(item["answer"], "C++")
        self.assertEqual(item["correct_answer"], "C++")
        self.assertEqual(item["card_id"], "stable-review-id")
        from test_generation_limits import main
        main.SavedStudySet(title="Repaired import", type="same_as_source", items=[item])

    def test_resume_keeps_generated_distractors_when_source_has_no_choices(self):
        record = parse_questionnaire(["1. Name the pigment.\nAnswer: Chlorophyll\nExplanation: " + RATIONALE])[0]
        old = convert_questionnaire([record], "multiple_choice", {"1": {"distractors": ["Melanin", "Keratin", "Hemoglobin"]}})[0]
        old["card_id"] = "stable-review-id"
        item = convert_questionnaire([record], "multiple_choice", {}, existing_items=[old])[0]
        self.assertEqual(item["options"], old["options"])
        self.assertEqual(item["option_labels"], old["option_labels"])
        self.assertEqual(item["answer"], "Chlorophyll")
        self.assertEqual(item["card_id"], "stable-review-id")

    def test_resume_replaces_matching_choices_while_retaining_valid_matches(self):
        source = "1. Match the terms.\n__First term\n__Second term\nE. First description\nF. Second description\nG. Extra description\nAnswer: 1-E; 2-F\nExplanation: The source key supplies the two associations."
        record = parse_questionnaire([source])[0]
        old = convert_questionnaire([record], "same_as_source", {})[0]
        old.update(matching_options=[*old["matching_options"], "phantom"],
                   option_labels=["A", "B", "C", "D"], card_id="matching-review-id")
        item = convert_questionnaire([record], "same_as_source", {}, existing_items=[old])[0]
        self.assertEqual(item["matching_options"], record["options"])
        self.assertEqual(item["option_labels"], ["E", "F", "G"])
        self.assertEqual(item["matching_pairs"], old["matching_pairs"])
        self.assertEqual(item["answer"], old["answer"])
        self.assertEqual(item["card_id"], "matching-review-id")

    def test_resume_rejects_saved_keys_that_conflict_with_repaired_source(self):
        for keyed in (True, False):
            with self.subTest(keyed=keyed):
                source = "1. Which language?\nE. C#\nF. C++\nG. Java" + ("\nAnswer: F" if keyed else "")
                record = parse_questionnaire([source])[0]
                old = {"question": record["question"], "answer": "C#" if keyed else "phantom",
                       "correct_answer": "C#" if keyed else "phantom", "imported": True,
                       "source_number": "1", "questionnaire_index": 1,
                       "options": ["C#", "C++", "Java", "phantom"], "card_id": "stable-review-id"}
                before = copy.deepcopy(old)
                with self.assertRaisesRegex(QuestionnaireError, "saved answer"):
                    convert_questionnaire([record], "same_as_source", {}, existing_items=[old], allow_incomplete=True)
                self.assertEqual(old, before)

    def test_resume_rejects_a_matching_answer_removed_from_source_choices(self):
        record = parse_questionnaire(["1. Match the terms.\n__First term\n__Second term\nE. First description\nF. Second description"])[0]
        old = {"question": record["question"], "answer": "First term — phantom\nSecond term — Second description",
               "imported": True, "source_number": "1", "questionnaire_index": 1, "quiz_type": "matching",
               "matching_options": ["First description", "Second description", "phantom"],
               "matching_pairs": [{"prompt": "First term", "answer": "phantom"},
                                  {"prompt": "Second term", "answer": "Second description"}],
               "card_id": "stable-review-id"}
        with self.assertRaisesRegex(QuestionnaireError, "saved matching answers"):
            convert_questionnaire([record], "same_as_source", {}, existing_items=[old])

    def test_explicit_all_correct_note_preserves_source_checkbox_key(self):
        source = "1. Which have a direct life cycle?\nA. First organism\nB. Second organism\nNOTE: All are the correct answer because no intermediate hosts are involved."
        record = parse_questionnaire([source])[0]
        self.assertEqual(record["correct_answers"], record["options"])
        self.assertEqual(record["quiz_type"], "checkbox")
        self.assertEqual(convert_questionnaire([record], "same_as_source", {})[0]["quiz_type"], "checkbox")
        with self.assertRaisesRegex(QuestionnaireError, "multiple correct answers"):
            convert_questionnaire([record], "multiple_choice", {})
        generic = parse_questionnaire([source.replace("NOTE: All are the correct answer because", "Rationale: All share a feature because")])[0]
        self.assertEqual(generic["answer"], "")


class ExplanationCompletionTests(unittest.TestCase):
    def test_required_ai_explanation_is_validated_and_tagged(self):
        record = parse_questionnaire([QUESTION])[0]
        record["explanation_required"] = True
        result = validate_completion([record], {"items": [completion(record)]}, "same_as_source")
        self.assertEqual(result["1"]["explanation"], RATIONALE)
        self.assertEqual(result["1"]["explanation_origin"], "ai")
        for missing in (None, "", "Chlorophyll", "AI-inferred answer: no answer key was supplied. Review it for accuracy."):
            with self.subTest(missing=missing), self.assertRaisesRegex(QuestionnaireError, "explanation"):
                validate_completion([record], {"items": [completion(record, missing)]}, "same_as_source")

    def test_supplied_explanation_overrides_model_text_without_rewriting_the_key(self):
        record = parse_questionnaire([QUESTION + "\nExplanation: " + RATIONALE])[0]
        result = validate_completion([record], {"items": [completion(record, "Model attempted overwrite")]}, "same_as_source", require_explanations=True)
        item = convert_questionnaire([record], "same_as_source", result)[0]
        self.assertEqual(item["explanation"], RATIONALE)
        self.assertEqual(item["explanation_origin"], "provided")
        changed = completion(record)
        changed["answer"] = "Melanin"
        with self.assertRaisesRegex(QuestionnaireError, "changed a supplied answer"):
            validate_completion([record], {"items": [changed]}, "same_as_source", require_explanations=True)

    def test_existing_answer_is_retained_while_its_missing_explanation_is_completed(self):
        record = parse_questionnaire([QUESTION])[0]
        record["explanation_required"] = True
        old = convert_questionnaire([record], "same_as_source", {})[0]
        old["card_id"] = "stable-review-id"
        self.assertTrue(old["explanation_pending"])
        filled = {"1": {"answer": "Wrong attempted answer", "explanation": RATIONALE, "explanation_origin": "ai"}}
        item = convert_questionnaire([record], "same_as_source", filled, existing_items=[old])[0]
        self.assertEqual(item["answer"], "Chlorophyll")
        self.assertEqual(item["card_id"], "stable-review-id")
        self.assertEqual(item["explanation"], RATIONALE)
        self.assertEqual(item["explanation_origin"], "ai")
        self.assertNotIn("explanation_pending", item)

    def test_source_explanation_is_preserved_on_resume(self):
        record = parse_questionnaire([QUESTION + "\nRationale: " + RATIONALE])[0]
        old = convert_questionnaire([record], "same_as_source", {})[0]
        old["card_id"] = "stable-review-id"
        item = convert_questionnaire([record], "same_as_source", {"1": {"explanation": "Overwrite"}}, existing_items=[old])[0]
        self.assertEqual(item["explanation"], RATIONALE)
        self.assertEqual(item["explanation_origin"], "provided")
        self.assertEqual(item["card_id"], "stable-review-id")

    def test_import_metadata_is_not_treated_as_a_teaching_explanation(self):
        record = parse_questionnaire(["1. Name the pigment."])[0]
        items = convert_questionnaire([record], "multiple_choice", {"1": {"answer": "Chlorophyll", "distractors": ["Melanin", "Keratin", "Hemoglobin"], "explanation": RATIONALE}})
        self.assertEqual(items[0]["explanation"], RATIONALE)
        self.assertEqual(items[0]["explanation_origin"], "ai")
        self.assertEqual(len(items[0]["import_notices"]), 2)
        self.assertNotIn("AI-inferred answer", items[0]["explanation"])
        legacy = {"explanation": "AI-inferred answer: no answer key was supplied. Review it for accuracy. Choices added by AI. Review them for accuracy."}
        self.assertEqual(questionnaire_item_explanation(legacy), "")
        self.assertEqual(questionnaire_item_explanation({**legacy, "explanation_origin": "provided"}), legacy["explanation"])

    def test_matching_key_explanation_only_completion_must_preserve_every_pair(self):
        record = parse_questionnaire(["1. Match the terms.\n__First term\n__Second term\nA. First description\nB. Second description\nAnswer: 1-A; 2-B"])[0]
        entry = completion(record, "Each term matches its corresponding source definition.")
        entry["matching_pairs"] = copy.deepcopy(record["matching_pairs"])
        result = validate_completion([record], {"items": [entry]}, "same_as_source", require_explanations=True)
        self.assertEqual(result["1"]["matching_pairs"], record["matching_pairs"])
        entry["matching_pairs"][0]["answer"] = "Second description"
        with self.assertRaisesRegex(QuestionnaireError, "changed a supplied matching answer"):
            validate_completion([record], {"items": [entry]}, "same_as_source", require_explanations=True)

    def test_partial_validation_only_accepts_items_with_requested_explanations(self):
        records = parse_questionnaire([QUESTION + "\n2. Name the energy unit.\nAnswer: Joule"])
        first, second = completion(records[0]), completion(records[1], "")
        verified, errors = validate_completion_partial(records, {"items": [first, second]}, "same_as_source", require_explanations=True)
        self.assertEqual(set(verified), {"1"})
        self.assertEqual(set(errors), {"2"})


if __name__ == "__main__":
    unittest.main()
