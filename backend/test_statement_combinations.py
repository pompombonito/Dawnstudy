"""Offline regressions for statement-combination generation and delivery."""

import copy
import hashlib
import json
from itertools import combinations
import unittest
from unittest.mock import Mock, patch

import accounts
from generation_jobs import GenerationJobs
from live_games import correct_answer
from quiz_blueprint import QuizBlueprint
from statement_combinations import STATEMENT_SCHEMA, build_statement_card
import test_generation_delivery as delivery


main = delivery.main
RAW_PROVIDER = main.generate_with_provider
EVIDENCE = [
    "Photosynthesis converts light into chemical energy.",
    "Chlorophyll absorbs light.",
    "Chloroplasts contain thylakoids.",
    "Carbon dioxide and water are converted into sugars and oxygen.",
]
SOURCE = " ".join(EVIDENCE)
STEM = "Which statements correctly describe photosynthesis?"


def raw_item(question=STEM, true_numbers=(1, 2)):
    return {
        "question": question,
        "statements": [
            {"text": evidence if number in true_numbers else f"Photosynthesis instead relies solely on process {number}.",
             "is_true": number in true_numbers, "evidence": evidence}
            for number, evidence in enumerate(EVIDENCE, 1)
        ],
    }


class StatementValidationTests(unittest.TestCase):
    def test_all_truth_patterns_have_four_unique_options_and_one_gradeable_answer(self):
        for size in (1, 2, 3):
            for true_numbers in combinations(range(1, 5), size):
                with self.subTest(true_numbers=true_numbers):
                    card = build_statement_card(raw_item(true_numbers=true_numbers), lambda quote: quote in SOURCE)
                    self.assertEqual(len(card["question"].splitlines()), 5)
                    self.assertEqual(len(set(card["options"])), 4)
                    correct = [option for option in card["options"] if correct_answer(card, "multiple_choice", option)]
                    self.assertEqual(correct, [card["answer"]])
                    self.assertEqual(tuple(int(char) for char in correct[0] if char.isdigit()), true_numbers)
                    self.assertEqual(len(card["statement_evidence"]), 4)
                    self.assertEqual(len(card["explanation"].splitlines()), 4)

    def test_rejects_bad_fourth_statement_even_when_first_three_are_grounded(self):
        for invalid in (
            {"evidence": "This is an invented source quotation."},
            {"is_true": "false"},
            {"text": EVIDENCE[3]},
        ):
            with self.subTest(invalid=invalid):
                item = raw_item()
                item["statements"][-1].update(invalid)
                self.assertIsNone(build_statement_card(item, lambda quote: quote in SOURCE))
        item = raw_item()
        item["statements"][-1]["text"] = item["statements"][0]["text"]
        self.assertIsNone(build_statement_card(item, lambda quote: quote in SOURCE))

    def test_provider_accepts_statement_payload_without_a_model_authored_answer(self):
        schema = {"properties": {"items": {"items": {"properties": {"statements": STATEMENT_SCHEMA}}}}}
        result = Mock(ok=True, status_code=200)
        result.json.return_value = {"candidates": [{"content": {"parts": [{"text": json.dumps({"items": [raw_item()]})}]}}]}
        with patch.object(main, "post_provider_json", return_value=result):
            payload = RAW_PROVIDER("gemini", "gemini-3.1-flash-lite", "test", "Use evidence", schema, 3500)
        self.assertEqual(payload["items"], [raw_item()])

    def test_stem_asks_for_the_same_verdict_that_the_app_grades(self):
        context = "Consider the role of chlorophyll."
        card = build_statement_card(raw_item(question=context), lambda quote: quote in SOURCE)
        self.assertEqual(card["question"].splitlines()[0], f"{context} Which statements are true?")
        self.assertIsNone(build_statement_card(raw_item(question="Which statements are false?"), lambda quote: quote in SOURCE))

    def test_provider_accepts_explicit_empty_source_result_only_for_blueprint_schema(self):
        empty = {"title": "", "items": [], "insufficient_source": True}
        result = Mock(ok=True, status_code=200)
        result.json.return_value = {"candidates": [{"content": {"parts": [{"text": json.dumps(empty)}]}}]}
        schema = {"properties": {"items": {"items": {"properties": {"statements": STATEMENT_SCHEMA}}}}}
        blueprint_schema = copy.deepcopy(schema)
        blueprint_schema["properties"]["insufficient_source"] = {"type": "boolean"}
        with patch.object(main, "post_provider_json", return_value=result):
            self.assertEqual(RAW_PROVIDER("gemini", "gemini-3.1-flash-lite", "test", "Use evidence", blueprint_schema, 3500), empty)
            with self.assertRaises(main.ProviderError):
                RAW_PROVIDER("gemini", "gemini-3.1-flash-lite", "test", "Use evidence", schema, 3500)


class StatementDeliveryTests(unittest.TestCase):
    def setUp(self):
        self.fixture = delivery.DeliveryTests(methodName="runTest")
        self.fixture.setUp()
        self.addCleanup(self.fixture.doCleanups)
        self.fixture.fixture.material = SOURCE.encode()

    def test_checkpoint_restart_preserves_question_format_and_retained_answer(self):
        first = raw_item()
        second = raw_item(question="Which descriptions of plant metabolism are accurate?", true_numbers=(2, 3, 4))
        provider = self.fixture.fixture.provider
        provider.side_effect = [
            {"title": "Plant metabolism", "items": [first]},
            main.ProviderError("groq", "groq:test", 429, "temporary quota", retry_after=91),
        ]
        fields = {"format": "multiple_choice", "statement_combinations": "true"}
        started = self.fixture.submit(count=2, **fields)
        self.assertEqual(started.status_code, 202, started.text)
        job = self.fixture.job()
        self.assertEqual(job["completed"], 1)
        checkpoint = job["checkpoint"]
        self.assertIs(checkpoint["statement_combinations"], True)
        self.assertEqual(checkpoint["items"][0]["answer"], "1 and 2 only")

        main.generation_jobs = GenerationJobs()
        rejected = self.fixture.submit(count=2, format="multiple_choice", checkpoint_json=json.dumps(checkpoint))
        self.assertEqual(rejected.status_code, 422, rejected.text)
        provider.side_effect = None
        provider.return_value = {"title": "Plant metabolism", "items": [second]}
        restored = self.fixture.submit(count=2, checkpoint_json=json.dumps(checkpoint), **fields)
        self.assertEqual(restored.status_code, 202, restored.text)
        result = self.fixture.job()["result"]
        self.assertIs(result["statement_combinations"], True)
        self.assertEqual([item["answer"] for item in result["items"]], ["1 and 2 only", "2, 3 and 4 only"])
        self.assertEqual(result["items"][0]["card_id"], checkpoint["items"][0]["card_id"])
        self.assertIn("is_true", provider.call_args.args[4]["properties"]["items"]["items"]["properties"]["statements"]["items"]["properties"])

        # Exercise the existing Sheets serialization and reload without network I/O.
        user_id = self.fixture.fixture.user["user_id"]
        stored = copy.deepcopy(result)
        stored["user_id"] = user_id
        with patch.object(accounts, "_append") as append:
            accounts.save_study_set(stored)
        row = dict(zip(accounts.SET_COLUMNS, append.call_args.args[1]))
        with patch.object(accounts, "_rows", return_value=[(2, row)]):
            reloaded = accounts.list_study_sets(user_id)[0]
        self.assertIs(reloaded["statement_combinations"], True)
        self.assertEqual(reloaded["items"], result["items"])

    def test_questionnaire_cannot_use_statement_generation(self):
        response = self.fixture.submit(count=1, format="multiple_choice", input_mode="questionnaire", statement_combinations="true")
        self.assertEqual(response.status_code, 422, response.text)
        self.fixture.fixture.provider.assert_not_called()

    def test_saved_tos_continuation_uses_original_format_and_topic_deficit(self):
        blueprint = QuizBlueprint.model_validate({"title": "Course quiz plan", "topics": [
            {"id": "t1", "title": "Photosynthesis", "weight": 1},
            {"id": "t2", "title": "Chloroplasts", "weight": 1},
        ]})
        user_id = self.fixture.fixture.user["user_id"]
        material = self.fixture.fixture.material
        fingerprint = hashlib.sha256((user_id + "\0" + hashlib.sha256(material).hexdigest()).encode()).hexdigest()
        first = {**build_statement_card(raw_item(), lambda quote: quote in SOURCE), "card_id": "retained-card", "blueprint_topic": "t1"}
        base = {"id": "saved-quiz", "user_id": user_id, "type": "multiple_choice", "title": "Retained quiz", "items": [first],
                "created_at": "2026-01-01T00:00:00Z", "requested_count": 2, "material_fingerprint": fingerprint,
                "incomplete": True, "statement_combinations": True, "quiz_blueprint": blueprint.model_dump()}
        self.fixture.fixture.sets[base["id"]] = base
        provider = self.fixture.fixture.provider
        provider.side_effect = None
        provider.return_value = {"title": "Plant metabolism", "items": [raw_item("How do chloroplasts contribute to plant metabolism?")]}
        resumed = self.fixture.submit(count=1, format="multiple_choice", study_set_id=base["id"])
        self.assertEqual(resumed.status_code, 202, resumed.text)
        job = self.fixture.job()
        self.assertEqual(job["status"], "complete", job)
        result = job["result"]
        self.assertFalse(result["incomplete"])
        self.assertEqual(result["id"], base["id"])
        self.assertIs(result["statement_combinations"], True)
        self.assertEqual(result["quiz_blueprint"], blueprint.model_dump())
        self.assertEqual(result["items"][0], first)
        self.assertEqual([item["blueprint_topic"] for item in result["items"]], ["t1", "t2"])
        self.assertEqual(result["blueprint_coverage"], [
            {"topic_id": "t1", "requested": 1, "completed": 1},
            {"topic_id": "t2", "requested": 1, "completed": 1},
        ])
        self.assertIn('"topic": "Chloroplasts"', provider.call_args.args[3])
