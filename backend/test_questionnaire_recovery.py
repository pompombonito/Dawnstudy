"""Questionnaire capacity recovery, with no credentials or external requests."""

import unittest
import copy
import json
from types import SimpleNamespace
from unittest.mock import patch

from questionnaire_recovery import complete_questionnaire_batches
from generation_jobs import GenerationJobs


def model(provider="first", name="test"):
    return (f"{provider}:{name}", provider, name, "test-key", f"{provider} {name}")


def records(count):
    return [{"number": str(number), "question": f"Source question {number}?"}
            for number in range(1, count + 1)]


class Deferred(Exception):
    def __init__(self, delay):
        self.delay = delay


class QuestionnaireRecoveryTests(unittest.TestCase):
    def run_completion(self, rows, models, attempt, **kwargs):
        self.clock = getattr(self, "clock", [0.0])
        return complete_questionnaire_batches(
            rows, models, attempt, lambda batch, _choice: batch,
            clock=lambda: self.clock[0],
            sleep=lambda duration: self.clock.__setitem__(0, self.clock[0] + duration),
            **kwargs,
        )

    def test_third_minute_quota_reset_does_not_end_a_durable_import(self):
        calls = []
        def attempt(_choice, batch):
            calls.append([record["number"] for record in batch])
            if len(calls) in {1, 3, 5}:
                return {}, {}, SimpleNamespace(status=429, retry_after=10)
            return {record["number"]: record for record in batch}, {}, None
        result, used, _error, _status = self.run_completion(records(24), [model()], attempt, durable=True)
        self.assertEqual(len(result), 24)
        self.assertEqual(used, ["first:test"])
        self.assertEqual(len(calls), 6)
        self.assertEqual(self.clock[0], 30)

    def test_retry_after_longer_than_a_minute_is_respected(self):
        calls = []
        def attempt(_choice, batch):
            calls.append(self.clock[0])
            if len(calls) == 1:
                return {}, {}, SimpleNamespace(status=429, retry_after=91)
            return {record["number"]: record for record in batch}, {}, None
        result, _used, _error, _status = self.run_completion(records(1), [model()], attempt)
        self.assertEqual(len(result), 1)
        self.assertEqual(calls, [0, 91])

    def test_durable_outage_defers_instead_of_holding_a_worker(self):
        def attempt(_choice, _batch):
            return {}, {}, SimpleNamespace(status=503, retry_after=17)
        with self.assertRaises(Deferred) as error:
            self.run_completion(records(1), [model()], attempt, durable=True,
                                defer=lambda delay: (_ for _ in ()).throw(Deferred(delay)))
        self.assertEqual(error.exception.delay, 17)
        self.assertEqual(self.clock[0], 0)

    def test_verified_subset_is_checkpointed_before_outage_deferral(self):
        calls, checkpoints = [], []
        def attempt(_choice, batch):
            calls.append([record["number"] for record in batch])
            return {batch[0]["number"]: batch[0]}, {}, SimpleNamespace(status=429, retry_after=7)
        with self.assertRaises(Deferred):
            self.run_completion(records(3), [model()], attempt, durable=True,
                                checkpoint=lambda verified, used: checkpoints.append((verified, used)),
                                defer=lambda delay: (_ for _ in ()).throw(Deferred(delay)))
        self.assertEqual(list(checkpoints[0][0]), ["1"])
        self.assertEqual(checkpoints[0][1], ["first:test"])
        self.assertEqual(calls, [["1", "2", "3"]])

    def test_other_provider_works_during_account_cooldown(self):
        calls = []
        def attempt(choice, batch):
            calls.append(choice[0])
            if choice[1] == "first":
                return {}, {}, SimpleNamespace(status=429, retry_after=60)
            return {record["number"]: record for record in batch}, {}, None
        result, used, _error, _status = self.run_completion(
            records(16), [model(), model("first", "sibling"), model("second")], attempt)
        self.assertEqual(len(result), 16)
        self.assertEqual(used, ["second:test"])
        self.assertEqual(calls, ["first:test", "second:test", "second:test"])
        self.assertEqual(self.clock[0], 0)

    def test_invalid_large_payload_retries_smaller_without_losing_verified_rows(self):
        calls = []
        def attempt(_choice, batch):
            numbers = [record["number"] for record in batch]
            calls.append(numbers)
            if len(batch) > 2:
                return {}, {}, SimpleNamespace(status=200, retry_after=None)
            return {record["number"]: record for record in batch}, {}, None
        result, _used, _error, _status = self.run_completion(
            records(8), [model()], attempt, durable=True,
            defer=lambda _delay: self.fail("Split malformed multi-question batches before waiting"))
        self.assertEqual(len(result), 8)
        self.assertEqual([len(batch) for batch in calls], [8, 4, 2, 2, 4, 2, 2])
        self.assertEqual(self.clock[0], 0)

    def test_malformed_single_item_response_defers_durable_work(self):
        for status, code in ((200, None), (400, "json_validate_failed"), (422, "json_validate_failed")):
            with self.subTest(status=status):
                def attempt(_choice, _batch):
                    return {}, {}, SimpleNamespace(status=status, error_code=code, retry_after=None)
                with self.assertRaises(Deferred) as error:
                    self.run_completion(records(1), [model()], attempt, durable=True,
                                        defer=lambda delay: (_ for _ in ()).throw(Deferred(delay)))
                self.assertEqual(error.exception.delay, 5)
                self.assertEqual(self.clock[0], 0)

    def test_malformed_single_item_can_recover_without_disabling_its_provider(self):
        calls = []
        def attempt(choice, batch):
            calls.append((choice[0], self.clock[0]))
            if len(calls) == 1:
                return {}, {}, SimpleNamespace(status=200, retry_after=None)
            return {record["number"]: record for record in batch}, {}, None
        result, used, _error, _status = self.run_completion(records(1), [model()], attempt, durable=True)
        self.assertEqual(len(result), 1)
        self.assertEqual(calls, [("first:test", 0), ("first:test", 5)])
        self.assertEqual(used, ["first:test"])

    def test_malformed_partial_response_checkpoints_before_deferring_remaining_record(self):
        checkpoints, calls = [], []
        def attempt(_choice, batch):
            calls.append([record["number"] for record in batch])
            verified = {batch[0]["number"]: batch[0]} if len(batch) > 1 else {}
            return verified, {}, SimpleNamespace(status=200, retry_after=None)
        with self.assertRaises(Deferred):
            self.run_completion(records(2), [model()], attempt, durable=True,
                                checkpoint=lambda verified, _used: checkpoints.append(verified),
                                defer=lambda delay: (_ for _ in ()).throw(Deferred(delay)))
        self.assertEqual(calls, [["1", "2"], ["2"]])
        self.assertEqual(list(checkpoints[-1]), ["1"])

    def test_omitted_single_record_gets_a_smaller_request(self):
        calls = []
        def attempt(_choice, batch):
            calls.append([record["number"] for record in batch])
            answered = batch[:1] if len(batch) > 1 else batch
            return {record["number"]: record for record in answered}, {}, None
        result, _used, _error, _status = self.run_completion(records(2), [model()], attempt)
        self.assertEqual(len(result), 2)
        self.assertEqual(calls, [["1", "2"], ["2"]])

    def test_genuinely_ambiguous_record_stays_unresolved_without_infinite_retry(self):
        calls = []
        def attempt(choice, batch):
            calls.append(choice[0])
            return {}, {record["number"]: "The answer is uncertain." for record in batch}, None
        result, _used, error, status = self.run_completion(
            records(1), [model(), model("second")], attempt, durable=True)
        self.assertEqual(result, {})
        self.assertEqual(calls, ["first:test", "second:test"])
        self.assertEqual(error, "The answer is uncertain.")
        self.assertEqual(status, 422)
        self.assertEqual(self.clock[0], 0)

    def test_direct_endpoint_has_bounded_outage_retries(self):
        calls = []
        def attempt(_choice, _batch):
            calls.append(self.clock[0])
            return {}, {}, SimpleNamespace(status=503, retry_after=None)
        result, _used, _error, status = self.run_completion(records(1), [model()], attempt)
        self.assertEqual(result, {})
        self.assertEqual(len(calls), 3)
        self.assertEqual(status, 503)
        self.assertEqual(self.clock[0], 15)

    def test_cancellation_during_wait_stops_retry(self):
        calls = []
        def cancelled():
            if self.clock[0] >= 1:
                raise InterruptedError("cancelled")
        def attempt(_choice, _batch):
            calls.append(1)
            return {}, {}, SimpleNamespace(status=429, retry_after=20)
        with self.assertRaises(InterruptedError):
            self.run_completion(records(1), [model()], attempt, cancelled=cancelled)
        self.assertEqual(calls, [1])
        self.assertEqual(self.clock[0], 1)

    def test_permanent_authorization_failure_does_not_loop(self):
        calls = []
        def attempt(choice, _batch):
            calls.append(choice[0])
            return {}, {}, SimpleNamespace(status=401, retry_after=None)
        result, _used, _error, status = self.run_completion(
            records(2), [model(), model("first", "sibling")], attempt, durable=True)
        self.assertEqual(result, {})
        self.assertEqual(calls, ["first:test"])
        self.assertEqual(status, 503)


class QuestionnaireRecoveryIntegrationTests(unittest.TestCase):
    def test_checkpoint_resume_keeps_keyed_item_and_retries_only_missing_answer(self):
        from test_generation_limits import main
        source = (
            "1. Which pigment absorbs light?\nA. Chlorophyll\nB. Melanin\nC. Hemoglobin\nD. Keratin\nAnswer: A\nExplanation: Chlorophyll captures light energy for photosynthesis.\n\n"
            "2. Which organelle releases usable energy?\nA. Nucleus\nB. Mitochondrion\nC. Ribosome\nD. Cell membrane"
        )
        choice = model("groq")
        checkpoints, submitted = [], []
        def capture(items, used, total):
            checkpoints.append((copy.deepcopy(items), list(used), total))
        def unavailable(_provider, _model, _key, prompt, _schema, _budget):
            batch = json.loads(prompt.rsplit("\n", 1)[-1])
            submitted.append([record["number"] for record in batch])
            raise main.ProviderError("groq", choice[0], 429, "temporary quota", retry_after=61)
        token = main._generation_durable.set(True)
        try:
            with patch.object(main, "configured_ai_models", return_value=[choice]), \
                 patch.object(main, "generate_with_provider", side_effect=unavailable), \
                 patch.object(main, "generation_defer", side_effect=lambda delay: (_ for _ in ()).throw(Deferred(delay))):
                with self.assertRaises(Deferred) as deferred:
                    main.import_questionnaire([source], "multiple_choice", "auto", checkpoint=capture)
            self.assertGreater(deferred.exception.delay, 60)
            self.assertEqual(len(checkpoints[-1][0]), 1)
            self.assertEqual(checkpoints[-1][0][0]["answer"], "Chlorophyll")
            self.assertEqual(checkpoints[-1][2], 2)
            def available(_provider, _model, _key, prompt, _schema, _budget):
                batch = json.loads(prompt.rsplit("\n", 1)[-1])
                submitted.append([record["number"] for record in batch])
                return {"items": [{"number": record["number"], "question": record["question"],
                                   "answer": "Mitochondrion", "uncertain": False,
                                   "explanation": "Mitochondria release usable energy through cellular respiration.",
                                   "distractors": [], "matching_pairs": []} for record in batch]}
            with patch.object(main, "configured_ai_models", return_value=[choice]), \
                 patch.object(main, "generate_with_provider", side_effect=available):
                items, _used, incomplete, total, unresolved = main.import_questionnaire(
                    [source], "multiple_choice", "auto", existing_items=checkpoints[-1][0], checkpoint=capture)
        finally:
            main._generation_durable.reset(token)
        self.assertEqual(submitted, [["2"], ["2"]])
        self.assertEqual([item["answer"] for item in items], ["Chlorophyll", "Mitochondrion"])
        self.assertFalse(incomplete)
        self.assertEqual(total, 2)
        self.assertEqual(unresolved, [])

    def test_smaller_batches_never_accept_a_rewritten_supplied_answer(self):
        from test_generation_limits import main
        source = (
            "1. Identify the pigment that absorbs light.\nAnswer: Chlorophyll\n\n"
            "2. Identify the organelle that releases usable energy.\nAnswer: Mitochondrion"
        )
        calls, checkpoints = [], []
        def available(_provider, _model, _key, prompt, _schema, _budget):
            batch = json.loads(prompt.rsplit("\n", 1)[-1])
            calls.append([record["number"] for record in batch])
            return {"items": [{"number": record["number"], "question": record["question"],
                               "answer": "Invented overwrite" if len(batch) > 1 else record["answer"],
                               "explanation": "The supplied answer identifies the structure responsible for this function.",
                               "uncertain": False, "distractors": ["Keratin", "Melanin", "Hemoglobin"],
                               "matching_pairs": []} for record in batch]}
        with patch.object(main, "configured_ai_models", return_value=[model("groq")]), \
             patch.object(main, "generate_with_provider", side_effect=available):
            items, _used, incomplete, _total, _unresolved = main.import_questionnaire(
                [source], "multiple_choice", "auto",
                checkpoint=lambda value, _used, _total: checkpoints.append(copy.deepcopy(value)))
        self.assertEqual(calls, [["1", "2"], ["1"], ["2"]])
        self.assertEqual([item["answer"] for item in items], ["Chlorophyll", "Mitochondrion"])
        self.assertFalse(incomplete)
        self.assertTrue(all(item["answer"] != "Invented overwrite" for batch in checkpoints for item in batch))


class GenerationDeferralRaceTests(unittest.TestCase):
    def test_cancel_between_worker_check_and_defer_returns_false(self):
        for running in (False, True):
            with self.subTest(running=running):
                jobs = GenerationJobs()
                job_id = jobs.start("student", 1)
                if running:
                    jobs.update(job_id, status="running")
                self.assertFalse(jobs.is_cancelled(job_id))
                # Reproduce the cancellation interleaving deterministically;
                # no real timers or scheduling races are needed by this test.
                jobs.cancel(job_id, "student")
                self.assertIs(jobs.defer(job_id, "Will retry"), False)
                self.assertEqual(jobs.get(job_id, "student")["status"],
                                 "cancelling" if running else "cancelled")


if __name__ == "__main__":
    unittest.main()
