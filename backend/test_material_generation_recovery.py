"""Exercise quota recovery and source coverage without consuming API credits."""
import json
import unittest
from unittest.mock import Mock, patch

from test_generation_limits import main
from material_batches import source_windows, advance_source_window_index


class RecoveryTests(unittest.TestCase):
    def test_provider_retries_keep_the_same_source_window_until_progress(self):
        index, completed = 0, 0
        self.assertEqual(advance_source_window_index(index, 0, completed, 4), 0)
        self.assertEqual(advance_source_window_index(index, 0, completed, 4), 0)
        index = advance_source_window_index(index, 3, completed, 4)
        completed = 3
        self.assertEqual(index, 1)
        self.assertEqual(advance_source_window_index(index, 3, completed, 4), 1)
        self.assertEqual(advance_source_window_index(index, 6, completed, 4), 2)

    def test_unusable_provider_batch_retries_smaller_without_relaxing_answer_checks(self):
        model = ("groq:openai/gpt-oss-120b", "groq", "openai/gpt-oss-120b", "test", "Test")
        calls = []

        def provider(_provider, _model, _key, _prompt, schema, _budget):
            batch_size = schema["properties"]["items"]["maxItems"]
            calls.append(batch_size)
            if len(calls) == 1:
                raise main.ProviderError("groq", model[0], 400, "invalid JSON", error_code="json_validate_failed")
            items = []
            for index in range(batch_size):
                question_number = len([item for item in items]) + sum(calls[1:-1]) + 1
                items.append({"question": f"Question {question_number}?", "answer": "Alpha", "correct_answer": "Alpha",
                              "options": ["Alpha", "Beta", "Gamma", "Delta"]})
            return {"title": "Set", "items": items}

        schema = {"properties": {"items": {"type": "array", "items": {"properties": {}}}}}
        with patch.object(main, "configured_ai_models", return_value=[model]), \
             patch.object(main, "generate_with_provider", side_effect=provider):
            result, _used, _fallback, incomplete = main.generate_with_fallback(
                lambda count, _done: f"Create {count}", schema, model[0], 6, study_format="multiple_choice")
        self.assertEqual(len(result["items"]), 6)
        self.assertFalse(incomplete)
        self.assertEqual(calls, [4, 2, 2, 2])
        self.assertTrue(all(item["answer"] == item["correct_answer"] == "Alpha" for item in result["items"]))

    def test_exact_source_evidence_accepts_pdf_line_wrap_hyphenation_only(self):
        source = "The micro-\norganism produces a distinctive result in culture."
        token = main._generation_grounding_text.set(source)
        try:
            self.assertTrue(main.has_source_evidence({"source_evidence": "The microorganism produces a distinctive result"}))
            self.assertFalse(main.has_source_evidence({"source_evidence": "The microorganism produces a different result"}))
        finally:
            main._generation_grounding_text.reset(token)

    def test_large_set_survives_longer_temporary_quota_resets(self):
        model = ("groq:openai/gpt-oss-120b", "groq", "openai/gpt-oss-120b", "test", "Test")
        clock, count, calls = [0.0], [0], [0]
        def provider(_provider, _model, _key, _prompt, schema, _budget):
            calls[0] += 1
            if calls[0] in {1, 5}:
                raise main.ProviderError("groq", model[0], 429, "quota", retry_after=45)
            items = []
            for _ in range(schema["properties"]["items"]["maxItems"]):
                count[0] += 1
                items.append({"question": f"What is concept {count[0]}?", "answer": "Alpha",
                              "correct_answer": "Alpha", "options": ["Alpha", "Beta", "Gamma", "Delta"]})
            return {"title": "Set", "items": items}
        schema = {"properties": {"items": {"type": "array", "items": {"properties": {}}}}}
        with patch.object(main, "configured_ai_models", return_value=[model]), \
             patch.object(main, "generate_with_provider", side_effect=provider), \
             patch.object(main.time, "monotonic", side_effect=lambda: clock[0]), \
             patch.object(main.time, "sleep", side_effect=lambda duration: clock.__setitem__(0, clock[0] + duration)):
            result, used, _fallback, incomplete = main.generate_with_fallback(lambda count, done: str(count), schema, model[0], 150, study_format="multiple_choice")
        self.assertEqual(len(result["items"]), 150)
        self.assertFalse(incomplete)
        self.assertEqual(used, [model[0]])
        self.assertGreaterEqual(clock[0], 90)
        self.assertTrue(all(item["answer"] == item["correct_answer"] == "Alpha" for item in result["items"]))

    def test_groq_rejected_json_recovers_only_items_with_real_evidence(self):
        good = {"question": "What absorbs light?", "answer": "Chlorophyll", "source_evidence": "Chlorophyll absorbs light"}
        bad = {**good, "source_evidence": "Chlorophyll exists in the liver"}
        response = Mock(ok=False, status_code=400)
        response.json.return_value = {"error": {"code": "json_validate_failed", "failed_generation": json.dumps({"items": [good, bad]})}}
        schema = {"properties": {"items": {"items": {"properties": {"source_evidence": {"type": "string"}}}}}}
        token = main._generation_grounding_text.set("Chlorophyll absorbs light in chloroplasts.")
        try:
            with patch.object(main, "post_provider_json", return_value=response):
                result = main.generate_with_provider("groq", "openai/gpt-oss-120b", "test", "Generate JSON", schema, 3000)
            self.assertEqual(result["items"], [good])
        finally:
            main._generation_grounding_text.reset(token)

    def test_every_selected_page_has_a_bounded_generation_window(self):
        source = "\n\n".join(f"[SOURCE: PDF page {n}]\n" + f"Concept {n} is supported by this page. " * 12 for n in range(1, 128))
        windows = source_windows(source)
        self.assertTrue(all(len(text) <= 6000 for text, _labels in windows))
        labels = {label for _text, labels in windows for label in labels}
        self.assertEqual(labels, {f"PDF page {n}" for n in range(1, 128)})

    def test_compact_course_packet_keeps_all_pages_in_one_source_context(self):
        source = "\n\n".join(f"[SOURCE: PDF page {n}]\n" + f"Concept {n} is supported by this page. " * 30 for n in range(1, 9))
        self.assertLess(len(source), 48_000)
        windows = source_windows(source)
        self.assertEqual(len(windows), 1)
        self.assertEqual(windows[0][0], source)
        self.assertEqual(windows[0][1], [f"PDF page {n}" for n in range(1, 9)])

    def test_generation_advances_source_after_all_models_stall_on_one_window(self):
        model = ("groq:test", "groq", "test", "test", "Test")
        source_window = [0]
        calls = []

        def prompt_builder(_count, _done):
            return f"Create questions from source window {source_window[0]}"

        def advance_source_window(_completed_count):
            if source_window[0] >= 1:
                return False
            source_window[0] += 1
            return True

        prompt_builder.advance_source_window = advance_source_window
        prompt_builder.source_window_count = 2

        def provider(_provider, _model, _key, prompt, schema, _budget):
            window = int(prompt.split("source window ", 1)[1].split()[0])
            calls.append(window)
            if window == 0:
                return {"title": "Set", "items": []}
            return {"title": "Set", "items": [
                {"question": "What does the first concept establish?", "answer": "A supported fact"},
                {"question": "What does the second concept establish?", "answer": "Another supported fact"},
            ][:schema["properties"]["items"]["maxItems"]]}

        schema = {"properties": {"items": {"type": "array", "items": {"properties": {}}}}}
        with patch.object(main, "configured_ai_models", return_value=[model]), \
             patch.object(main, "generate_with_provider", side_effect=provider):
            result, _used, _fallback, incomplete = main.generate_with_fallback(
                prompt_builder, schema, model[0], 2, study_format="identification")
        self.assertEqual(len(result["items"]), 2)
        self.assertFalse(incomplete)
        self.assertEqual(source_window[0], 1)
        self.assertEqual(calls, [0, 0, 0, 0, 0, 1])

    def test_zai_1305_overload_fails_over_without_quota_cooldown(self):
        zai = ("zai:glm-4.7-flash", "zai", "glm-4.7-flash", "zai-key", "GLM Flash")
        groq = ("groq:qwen", "groq", "qwen/qwen3.8-27b", "groq-key", "Qwen")
        schema = {"properties": {"items": {"type": "array", "items": {"properties": {}}}}}

        def provider(provider_name, model_name, _key, _prompt, _schema, _budget):
            if provider_name == "zai":
                raise main.ProviderError("zai", f"zai:{model_name}", 429, "overloaded", error_code="1305")
            return {"title": "Set", "items": [{"question": "What is the supported concept?", "answer": "A fact"}]}

        with patch.object(main, "configured_ai_models", return_value=[zai, groq]), \
             patch.object(main, "generate_with_provider", side_effect=provider), \
             patch.object(main.time, "sleep", side_effect=AssertionError("Z.AI overload should fail over immediately")):
            result, used, fallback, incomplete = main.generate_with_fallback(
                lambda _count, _done: "Use the supplied source", schema, zai[0], 1, study_format="identification")
        self.assertEqual(len(result["items"]), 1)
        self.assertEqual(used, [groq[0]])
        self.assertEqual(fallback["reason"], "busy")
        self.assertFalse(incomplete)
        self.assertEqual(main.provider_failure_reason(main.ProviderError("zai", zai[0], 429, "overloaded", error_code="1305")), "busy")


if __name__ == "__main__":
    unittest.main()
