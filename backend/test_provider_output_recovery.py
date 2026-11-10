"""Replay malformed/empty/truncated completions locally, with no AI calls."""
import json
import unittest
from unittest.mock import Mock, patch

from test_generation_limits import main


SCHEMA = {"properties": {"items": {"type": "array", "items": {"properties": {
    "question": {"type": "string"}, "answer": {"type": "string"},
    "source_evidence": {"type": "string"},
}}}}}
GOOD = {"question": "What carries inherited information?", "answer": "DNA",
        "source_evidence": "DNA stores genetic information"}


def response(parts, reason="STOP", **metadata):
    result = Mock(ok=True, status_code=200, headers={})
    result.json.return_value = {"candidates": [{"content": {"parts": parts}, "finishReason": reason}],
                                "usageMetadata": metadata}
    return result


class OutputRecoveryTests(unittest.TestCase):
    def setUp(self):
        token = main._generation_grounding_text.set("DNA stores genetic information for inheritance.")
        self.addCleanup(main._generation_grounding_text.reset, token)

    def call(self, result):
        with patch.object(main, "post_provider_json", return_value=result):
            return main.generate_with_provider("gemini", "gemini-3.1-flash-lite", "private-key", "private prompt", SCHEMA, 3500)

    def test_thought_json_is_never_used_as_the_final_study_set(self):
        thought = {**GOOD, "question": "Draft question that must not be used?"}
        result = self.call(response([
            {"thought": True, "text": json.dumps({"items": [thought]})},
            {"text": json.dumps({"items": [GOOD]})},
        ]))
        self.assertEqual(result["items"], [GOOD])

    def test_thought_only_truncation_is_diagnosed_without_salvaging_draft_cards(self):
        with self.assertRaises(main.ProviderError) as raised:
            self.call(response([{"thought": True, "text": json.dumps({"items": [GOOD]})}],
                               "MAX_TOKENS", thoughtsTokenCount=3500, candidatesTokenCount=0))
        error = raised.exception
        self.assertEqual(error.error_code, "output_truncated")
        self.assertEqual(error.partial_items, [])
        self.assertEqual(error.output_diagnostics, {"thoughtsTokenCount": 3500, "candidatesTokenCount": 0,
                                                   "output_chars": 0, "finish_reason": "MAX_TOKENS"})
        diagnostic = main.describe_provider_failure(error)
        self.assertNotIn("private", diagnostic)
        self.assertNotIn(GOOD["question"], diagnostic)

    def test_unverifiable_quotes_and_empty_output_have_distinct_failures(self):
        for parts, code in (([], "empty_output"), ([{"text": "not JSON"}], "invalid_json"),
                            ([{"text": json.dumps({"items": [{**GOOD, "source_evidence": "An invented supporting quote"}]})}], "missing_source_evidence")):
            with self.subTest(code=code), self.assertRaises(main.ProviderError) as raised:
                self.call(response(parts))
            self.assertEqual(raised.exception.error_code, code)
            self.assertFalse(raised.exception.partial_items)

    def test_partial_truncation_salvages_only_complete_grounded_items(self):
        partial = '{"items":[' + json.dumps(GOOD) + ',{"question":"unfinished'
        with self.assertRaises(main.ProviderError) as raised:
            self.call(response([{"text": partial}], "MAX_TOKENS"))
        self.assertEqual(raised.exception.error_code, "output_truncated")
        self.assertEqual(raised.exception.partial_items, [GOOD])

    def test_gemini_3_uses_low_thinking_without_unsupported_25_settings(self):
        for model in ("gemini-3.1-flash-lite", "gemini-3.5-flash-lite", "gemini-2.5-flash-lite"):
            with self.subTest(model=model), patch.object(main, "post_provider_json", return_value=response([
                {"text": json.dumps({"items": [GOOD]})}])) as post:
                main.generate_with_provider("gemini", model, "key", "Use the source", SCHEMA, 3500)
            config = post.call_args.kwargs["payload"]["generationConfig"]
            if model.startswith("gemini-3"):
                self.assertEqual(config["thinkingConfig"], {"thinkingLevel": "LOW"})
            else:
                self.assertNotIn("thinkingConfig", config)

    def test_single_item_truncation_gets_bounded_output_room_then_delivers(self):
        model = ("gemini:test", "gemini", "gemini-3.1-flash-lite", "key", "Test")
        budgets = []
        def attempt(_provider, _model, _key, _prompt, schema, tokens):
            budgets.append(tokens)
            self.assertEqual(schema["properties"]["items"]["maxItems"], 1)
            if tokens < 8192:
                raise main.ProviderError("gemini", model[0], 200, "truncated", error_code="output_truncated")
            return {"items": [GOOD]}
        with patch.object(main, "configured_ai_models", return_value=[model]), \
             patch.object(main, "generate_with_provider", side_effect=attempt):
            result, _models, _fallback, incomplete = main.generate_with_fallback(
                lambda _count, _done: "Use source", SCHEMA, model[0], 1, study_format="flashcards")
        self.assertEqual(budgets, [3500, 7000, 8192])
        self.assertEqual(result["items"], [GOOD])
        self.assertFalse(incomplete)

    def test_missing_evidence_retry_gets_a_specific_correction(self):
        model = ("groq:test", "groq", "test", "key", "Test")
        prompts = []
        def attempt(_provider, _model, _key, prompt, _schema, _tokens):
            prompts.append(prompt)
            if len(prompts) == 1:
                raise main.ProviderError("groq", model[0], 200, "quote missing", error_code="missing_source_evidence")
            return {"items": [GOOD, {**GOOD, "question": "What molecule stores genetic information?"}]}
        with patch.object(main, "configured_ai_models", return_value=[model]), \
             patch.object(main, "generate_with_provider", side_effect=attempt):
            result, *_rest = main.generate_with_fallback(lambda *_args: "Use source", SCHEMA, model[0], 2)
        self.assertEqual(len(result["items"]), 2)
        self.assertIn("copy one contiguous", prompts[1])
        self.assertIn("Do not paraphrase", prompts[1])

    def test_unavailable_model_does_not_cool_down_a_working_sibling(self):
        models = [("gemini:first", "gemini", "first", "key", "First"),
                  ("gemini:second", "gemini", "second", "key", "Second")]
        attempted = []
        def attempt(_provider, model, *_args):
            attempted.append(model)
            if model == "first":
                raise main.ProviderError("gemini", models[0][0], 503, "unavailable")
            return {"items": [GOOD]}
        with patch.object(main, "configured_ai_models", return_value=models), \
             patch.object(main, "generate_with_provider", side_effect=attempt), \
             patch.object(main.time, "sleep", side_effect=AssertionError("A sibling can work now")):
            result, *_rest = main.generate_with_fallback(lambda *_args: "Use source", SCHEMA, models[0][0], 1)
        self.assertEqual(attempted, ["first", "second"])
        self.assertEqual(result["items"], [GOOD])


if __name__ == "__main__":
    unittest.main()
