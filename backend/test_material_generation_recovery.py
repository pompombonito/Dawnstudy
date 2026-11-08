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
        self.assertEqual(calls, [2, 1, 1, 1, 1, 1, 1])
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

    def test_generation_keeps_failing_over_after_three_minutes_without_progress(self):
        primary = ("groq:openai/gpt-oss-120b", "groq", "openai/gpt-oss-120b", "groq-key", "GPT-OSS")
        fallback = ("gemini:gemini-3.8-flash", "gemini", "gemini-3.8-flash", "gemini-key", "Gemini")
        clock = [0.0]

        def provider(provider_name, model_name, _key, _prompt, _schema, _budget):
            if provider_name == "groq":
                clock[0] = 181
                raise main.ProviderError(provider_name, model_name, 503, "temporarily unavailable")
            return {"title": "Set", "items": [{"question": "What is supported?", "answer": "A verified fact"}]}

        schema = {"properties": {"items": {"items": {"properties": {}}}}}
        with patch.object(main, "configured_ai_models", return_value=[primary, fallback]), \
             patch.object(main, "generate_with_provider", side_effect=provider), \
             patch.object(main.time, "monotonic", side_effect=lambda: clock[0]):
            result, used, _fallback, incomplete = main.generate_with_fallback(
                lambda _count, _done: "Use the supplied source", schema, primary[0], 1,
                study_format="identification")

        self.assertEqual(len(result["items"]), 1)
        self.assertEqual(used, [fallback[0]])
        self.assertFalse(incomplete)

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

    def test_generation_windows_fit_small_provider_contexts_without_skipping_pages(self):
        source = "\n\n".join(f"[SOURCE: PDF page {n}]\n" + f"Concept {n} is supported. " * 120 for n in range(1, 20))
        windows = source_windows(source, maximum=5_000, full_context_maximum=5_000)
        self.assertGreater(len(windows), 1)
        self.assertTrue(all(len(window) <= 5_000 for window, _labels in windows))
        self.assertEqual(
            {label for _window, labels in windows for label in labels},
            {f"PDF page {n}" for n in range(1, 20)},
        )

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
        self.assertEqual(calls, [0, 0, 0, 1])

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

    def test_busy_ollama_fails_over_immediately_without_blocking_gemini(self):
        ollama = ("ollama:qwen3:4b", "ollama", "qwen3:4b", "ollama", "Ollama Qwen3 4B")
        gemini = ("gemini:gemini-2.5-flash-lite", "gemini", "gemini-2.5-flash-lite", "gemini-key", "Gemini")
        calls = []

        def provider(provider_name, model_name, _key, _prompt, _schema, _budget):
            calls.append(provider_name)
            if provider_name == "ollama":
                raise main.ProviderError(provider_name, model_name, 503, "local capacity busy",
                                         error_code="local_capacity")
            return {"title": "Set", "items": [{"question": "What is supported?", "answer": "A verified fact"}]}

        schema = {"properties": {"items": {"type": "array", "items": {"properties": {}}}}}
        with patch.object(main, "configured_ai_models", return_value=[ollama, gemini]), \
             patch.object(main, "generate_with_provider", side_effect=provider):
            result, used, fallback, incomplete = main.generate_with_fallback(
                lambda _count, _done: "Use the supplied source", schema, ollama[0], 1,
                study_format="identification")
        self.assertEqual(len(result["items"]), 1)
        self.assertEqual(calls, ["ollama", "gemini"])
        self.assertEqual(used, [gemini[0]])
        self.assertEqual(fallback, {"from": ollama[0], "to": gemini[0], "reason": "busy"})
        self.assertFalse(incomplete)

    def test_restricted_gemini_25_model_does_not_block_later_gemini_fallbacks(self):
        restricted = ("gemini:gemini-2.5-flash-lite", "gemini", "gemini-2.5-flash-lite", "gemini-key", "Gemini 2.5")
        fallback = ("gemini:gemini-3.1-flash-lite", "gemini", "gemini-3.1-flash-lite", "gemini-key", "Gemini 3.1")
        schema = {"properties": {"items": {"type": "array", "items": {"properties": {}}}}}
        for status in (403, 404):
            calls = []

            def provider(_provider, model_name, _key, _prompt, _schema, _budget):
                calls.append(model_name)
                if model_name == restricted[2]:
                    raise main.ProviderError("gemini", model_name, status, "model unavailable")
                return {"title": "Set", "items": [{"question": "What is supported?", "answer": "A verified fact"}]}

            with self.subTest(status=status), \
                 patch.object(main, "configured_ai_models", return_value=[restricted, fallback]), \
                 patch.object(main, "generate_with_provider", side_effect=provider):
                result, used, _fallback, incomplete = main.generate_with_fallback(
                    lambda _count, _done: "Use the supplied source", schema, restricted[0], 1,
                    study_format="identification")
            self.assertEqual(len(result["items"]), 1)
            self.assertEqual(calls, [restricted[2], fallback[2]])
            self.assertEqual(used, [fallback[0]])
            self.assertFalse(incomplete)

    def test_quota_without_retry_after_skips_provider_siblings_and_fails_over(self):
        groq_primary = ("groq:primary", "groq", "primary", "groq-key", "Groq primary")
        zai = ("zai:fallback", "zai", "fallback", "zai-key", "Z.ai fallback")
        groq_sibling = ("groq:sibling", "groq", "sibling", "groq-key", "Groq sibling")
        calls = []

        def provider(provider_name, model_name, _key, _prompt, _schema, _budget):
            calls.append((provider_name, model_name))
            if provider_name == "groq":
                raise main.ProviderError(provider_name, model_name, 429, "quota exhausted")
            return {"title": "Set", "items": [{"question": "What is supported?", "answer": "A verified fact"}]}

        schema = {"properties": {"items": {"type": "array", "items": {"properties": {}}}}}
        with patch.object(main, "configured_ai_models", return_value=[groq_primary, zai, groq_sibling]), \
             patch.object(main, "generate_with_provider", side_effect=provider), \
             patch.object(main.time, "sleep", side_effect=AssertionError("A quota without Retry-After must not wait")):
            result, used, fallback, incomplete = main.generate_with_fallback(
                lambda _count, _done: "Use the supplied source", schema, groq_primary[0], 1,
                study_format="identification")

        self.assertEqual(calls, [("groq", "primary"), ("zai", "fallback")])
        self.assertEqual(len(result["items"]), 1)
        self.assertEqual(used, [zai[0]])
        self.assertEqual(fallback["reason"], "limit")
        self.assertFalse(incomplete)


if __name__ == "__main__":
    unittest.main()
