"""Routing and quota regressions do not make external provider requests."""

import copy
import unittest

from provider_policy import (ProviderAttemptPolicy, eligible_questionnaire_records,
                             interleave_order, order_model_candidates,
                             questionnaire_needs_vision)


def choice(provider, model):
    return (f"{provider}:{model}", provider, model, "not-a-real-key", model)


class ProviderRoutingTests(unittest.TestCase):
    def setUp(self):
        self.models = [choice("first", "text-a"), choice("first", "text-b"),
                       choice("second", "vision-a"), choice("second", "vision-b"),
                       choice("third", "text-c")]

    def ids(self, models):
        return [model[0] for model in models]

    def test_fallback_reaches_another_provider_before_sibling_models(self):
        ordered = order_model_candidates(self.models, "first:text-a")
        self.assertEqual(self.ids(ordered), ["first:text-a", "second:vision-a", "third:text-c", "first:text-b", "second:vision-b"])

    def test_auto_rotation_preserves_each_providers_model_preference(self):
        ordered = order_model_candidates(self.models, rotation=1)
        self.assertEqual(self.ids(ordered), ["second:vision-a", "third:text-c", "first:text-a", "second:vision-b", "first:text-b"])

    def test_vision_and_ocr_never_fall_back_to_models_without_pixels(self):
        capability = lambda provider, model: provider == "second"
        for task in ("vision", "ocr"):
            with self.subTest(task=task):
                ordered = order_model_candidates(self.models, "first:text-a", task=task, supports_images=capability)
                self.assertEqual(self.ids(ordered), ["second:vision-a", "second:vision-b"])
        self.assertEqual(order_model_candidates(self.models, task="vision"), [])

    def test_selection_and_duplicate_model_ids_are_handled_without_mutation(self):
        models = [*self.models, self.models[0]]
        before = copy.deepcopy(models)
        ordered = order_model_candidates(models, "second:vision-b", rotation=1)
        self.assertEqual(ordered[0][0], "second:vision-b")
        self.assertEqual(len(ordered), len(self.models))
        self.assertEqual(models, before)

    def test_supplied_answers_are_never_sent_for_visual_re_solving(self):
        supplied = [{"question": "An image question", "images": ["image"], "answer": "Preserve this key"}]
        before = copy.deepcopy(supplied)
        self.assertFalse(questionnaire_needs_vision(supplied))
        self.assertEqual(supplied, before)
        self.assertTrue(questionnaire_needs_vision([{**supplied[0], "answer": ""}]))
        self.assertFalse(questionnaire_needs_vision([{"question": "A text question", "answer": ""}]))

    def test_mixed_questionnaire_keeps_text_work_while_pixels_wait_for_vision(self):
        records = [{"number": "1", "images": ["figure"], "answer": " "},
                   {"number": "2", "images": ["figure"], "answer": "Provided key", "options": []},
                   {"number": "3", "answer": "", "options": ["First", "Second"]}]
        before = copy.deepcopy(records)
        self.assertEqual([row["number"] for row in eligible_questionnaire_records(records, False)], ["2", "3"])
        self.assertEqual(eligible_questionnaire_records(records, True), records)
        self.assertEqual(records, before)

    def test_existing_fallback_signature_can_interleave_without_repeating_primary(self):
        ordered = interleave_order(self.models[0], self.models)
        self.assertEqual(self.ids(ordered), ["first:text-a", "second:vision-a", "third:text-c", "first:text-b", "second:vision-b"])


class ProviderFailureBudgetTests(unittest.TestCase):
    def test_quota_failure_blocks_all_sibling_models_for_later_batches(self):
        policy = ProviderAttemptPolicy()
        policy.record_failure("first", "model-a", 429)
        self.assertFalse(policy.can_attempt("first", "model-b"))
        self.assertFalse(policy.can_attempt("first", "model-a"))
        self.assertTrue(policy.can_attempt("second", "model-a"))
        self.assertEqual(policy.blocked_providers["first"], "quota")

    def test_authorization_failures_block_provider_and_do_not_expose_keys(self):
        for status in (401, 403):
            policy = ProviderAttemptPolicy()
            policy.record_failure("first", "model-a", status)
            self.assertFalse(policy.can_attempt("first", "model-b"))
            self.assertEqual(policy.blocked_providers["first"], "authorization")

    def test_transient_or_invalid_results_allow_one_other_model(self):
        for status in (None, 200, 400, 404, 413, 422, 500, 503):
            with self.subTest(status=status):
                policy = ProviderAttemptPolicy()
                policy.record_failure("first", "model-a", status)
                self.assertFalse(policy.can_attempt("first", "model-a"))
                self.assertTrue(policy.can_attempt("first", "model-b"))
                policy.record_failure("first", "model-b", status)
                self.assertFalse(policy.can_attempt("first", "model-c"))

    def test_duplicate_failure_is_counted_once(self):
        policy = ProviderAttemptPolicy()
        policy.record_failure("first", "model-a", 500)
        policy.record_failure("first", "model-a", 500)
        self.assertEqual(policy.provider_failures["first"], 1)
        self.assertTrue(policy.can_attempt("first", "model-b"))

    def test_healthy_model_can_finish_many_batches_and_new_job_starts_fresh(self):
        policy = ProviderAttemptPolicy()
        for _ in range(30):
            self.assertTrue(policy.can_attempt("first", "healthy"))
        policy.record_failure("first", "healthy", 429)
        self.assertFalse(policy.can_attempt("first", "healthy"))
        self.assertTrue(ProviderAttemptPolicy().can_attempt("first", "healthy"))


if __name__ == "__main__":
    unittest.main()
