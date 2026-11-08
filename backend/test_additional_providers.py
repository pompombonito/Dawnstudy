"""Provider contracts with synthetic responses; never consumes live API quota."""
import json
import unittest
from unittest.mock import Mock, patch

from test_generation_limits import main


class AdditionalProviderTests(unittest.TestCase):
    def response(self, status=200):
        response = Mock(ok=status == 200, status_code=status)
        response.json.return_value = ({"choices": [{"message": {"content": json.dumps({
            "title": "Source material", "items": [{"question": "What is demonstrated?", "answer": "A supported fact"}]
        })}}]} if status == 200 else {"error": {"code": "rate_limit", "message": "private prompt omitted"}})
        return response

    def test_model_order_is_an_allowlist_and_provider_keys_only_enable_listed_models(self):
        environment = {"GROQ_API_KEY": "groq-test", "CLOUDFLARE_API_TOKEN": "cf-test",
                       "CLOUDFLARE_ACCOUNT_ID": "a" * 32, "VERCEL_AI_GATEWAY_API_KEY": "vercel-test",
                       "TYPHOON_API_KEY": "typhoon-test", "AI_MODEL_ORDER": "groq:openai/gpt-oss-120b"}
        with patch.dict(main.os.environ, environment, clear=True), patch.object(main.requests, "get", side_effect=AssertionError("No startup requests")):
            models = main.configured_ai_models()
        self.assertEqual([model[0] for model in models], ["groq:openai/gpt-oss-120b"])
        environment["AI_MODEL_ORDER"] += ",cloudflare:@cf/google/gemma-4-26b-a4b-it,vercel:nvidia/nemotron-3.5-lightning-free,typhoon:typhoon-v2.5-30b-a3b-instruct"
        with patch.dict(main.os.environ, environment, clear=True):
            models = main.configured_ai_models()
        keys = {provider: key for _id, provider, _model, key, _label in models}
        self.assertEqual(keys, {"groq": "groq-test", "cloudflare": "cf-test", "vercel": "vercel-test", "typhoon": "typhoon-test"})
        with patch.dict(main.os.environ, {}, clear=True):
            self.assertEqual(main.configured_ai_models(), [])

    def test_antigravity_uses_gemini_key_and_is_listed_as_a_separate_provider(self):
        environment = {
            "GEMINI_API_KEY": "gemini-test",
            "AI_MODEL_ORDER": "gemini:gemini-3.8-flash,antigravity:antigravity-preview-09-2026,groq:openai/gpt-oss-120b",
            "GROQ_API_KEY": "groq-test",
        }
        with patch.dict(main.os.environ, environment, clear=True):
            models = main.configured_ai_models()
        self.assertEqual([model[0] for model in models], [
            "gemini:gemini-3.8-flash",
            "antigravity:antigravity-preview-09-2026",
            "groq:openai/gpt-oss-120b",
        ])
        self.assertEqual(models[1][1:4], ("antigravity", "antigravity-preview-09-2026", "gemini-test"))

    def test_antigravity_interactions_api_uses_disabled_tools_and_parses_agent_output(self):
        response = Mock(ok=True, status_code=200)
        response.json.return_value = {
            "status": "completed",
            "outputs": [{"type": "text", "text": json.dumps({
                "title": "Source material",
                "items": [{"question": "What is demonstrated?", "answer": "A supported fact"}],
            })}],
        }
        with patch.object(main, "post_provider_json", return_value=response) as post:
            result = main.generate_with_provider(
                "antigravity", "antigravity-preview-09-2026", "gemini-test",
                "Return a JSON study set.", {"type": "object"}, 1200)
        self.assertEqual(result["title"], "Source material")
        self.assertEqual(
            post.call_args.args[0],
            "https://generativelanguage.googleapis.com/v1beta/interactions",
        )
        self.assertEqual(post.call_args.kwargs["headers"], {"x-goog-api-key": "gemini-test"})
        self.assertEqual(post.call_args.kwargs["payload"]["agent"], "antigravity-preview-09-2026")
        self.assertEqual(post.call_args.kwargs["payload"]["tools"], [])
        self.assertNotIn("environment", post.call_args.kwargs["payload"])
        self.assertGreaterEqual(post.call_args.kwargs["timeout"], 120)

    def test_antigravity_interactions_api_receives_supported_image_inputs(self):
        response = Mock(ok=True, status_code=200)
        response.json.return_value = {
            "status": "completed",
            "steps": [{"type": "model_output", "content": [{"type": "text", "text": json.dumps({
                "title": "Source material",
                "items": [{"question": "What is demonstrated?", "answer": "A supported fact"}],
            })}]}],
        }
        image = "data:image/png;base64,aGVsbG8="
        with patch.object(main, "post_provider_json", return_value=response) as post:
            token = main._provider_images.set((("Figure 1", image),))
            try:
                main.generate_with_provider(
                    "antigravity", "antigravity-preview-09-2026", "gemini-test",
                    "Use the figure.", {"type": "object"}, 1200)
            finally:
                main._provider_images.reset(token)
        input_content = post.call_args.kwargs["payload"]["input"]
        self.assertTrue(input_content[0]["text"].startswith("Use the figure."))
        self.assertEqual(input_content[1], {"type": "text", "text": "Figure 1"})
        self.assertEqual(input_content[2], {"type": "image", "mime_type": "image/png", "data": "aGVsbG8="})

    def test_blank_model_order_uses_default_catalog_but_unknown_ids_are_ignored(self):
        environment = {
            "GROQ_API_KEY": "groq-test",
            "CLOUDFLARE_API_TOKEN": "cf-test",
            "CLOUDFLARE_ACCOUNT_ID": "a" * 32,
            "VERCEL_AI_GATEWAY_API_KEY": "vercel-test",
            "TYPHOON_API_KEY": "typhoon-test",
            "AI_MODEL_ORDER": " ",
        }
        with patch.dict(main.os.environ, environment, clear=True):
            models = main.configured_ai_models()
        self.assertTrue(models)
        self.assertTrue(all(model[1] not in {"cloudflare", "vercel", "typhoon"} for model in models))
        environment["AI_MODEL_ORDER"] = "unknown:model,groq:openai/gpt-oss-120b,groq:openai/gpt-oss-120b"
        with patch.dict(main.os.environ, environment, clear=True):
            self.assertEqual([model[0] for model in main.configured_ai_models()], ["groq:openai/gpt-oss-120b"])

    def test_ollama_is_primary_and_gemini_fallbacks_keep_the_requested_sequence(self):
        environment = {
            "OLLAMA_BASE_URL": "http://127.0.0.1:11434/v1",
            "GEMINI_API_KEY": "gemini-test",
            "GROQ_API_KEY": "groq-test",
            "AI_MODEL_ORDER": "groq:openai/gpt-oss-120b,gemini:gemini-3.1-flash-lite,gemini:gemini-2.5-flash,gemini:gemini-2.5-flash-lite",
        }
        with patch.dict(main.os.environ, environment, clear=True):
            models = main.configured_ai_models()
            selected, _reason = main.choose_auto_model(models, 1_000, 30_000, 100)
        self.assertEqual([model[0] for model in models], [
            "ollama:qwen3:4b",
            "gemini:gemini-2.5-flash-lite",
            "gemini:gemini-2.5-flash",
            "gemini:gemini-3.1-flash-lite",
            "groq:openai/gpt-oss-120b",
        ])
        self.assertEqual(selected, "ollama:qwen3:4b")
        ordered = main.fallback_order(models[0], models[1:])
        self.assertEqual([model[0] for model in ordered], [model[0] for model in models])

    def test_auto_starts_with_gemini_sequence_when_ollama_is_not_configured(self):
        environment = {
            "GEMINI_API_KEY": "gemini-test",
            "GROQ_API_KEY": "groq-test",
            "AI_MODEL_ORDER": "groq:openai/gpt-oss-120b,gemini:gemini-3.1-flash-lite,gemini:gemini-2.5-flash,gemini:gemini-2.5-flash-lite",
        }
        with patch.dict(main.os.environ, environment, clear=True):
            models = main.configured_ai_models()
            selected, _reason = main.choose_auto_model(models, 1_000, 30_000, 100)
        self.assertEqual(selected, "gemini:gemini-2.5-flash-lite")
        ordered = main.fallback_order(next(model for model in models if model[0] == selected), models)
        self.assertEqual([model[0] for model in ordered], [
            "gemini:gemini-2.5-flash-lite",
            "gemini:gemini-2.5-flash",
            "gemini:gemini-3.1-flash-lite",
            "groq:openai/gpt-oss-120b",
        ])

    def test_ollama_endpoint_requires_local_http_or_remote_https_with_access(self):
        with patch.dict(main.os.environ, {"OLLAMA_BASE_URL": "http://localhost:11434/v1"}, clear=True):
            self.assertEqual(
                main.compatible_chat_endpoint("ollama", "qwen3:4b"),
                "http://localhost:11434/v1/chat/completions",
            )
        for endpoint in ("http://example.com/v1", "https://example.com/v1?redirect=1", "https://example.com/api"):
            with self.subTest(endpoint=endpoint), patch.dict(main.os.environ, {"OLLAMA_BASE_URL": endpoint}, clear=True):
                with self.assertRaises(main.ProviderError):
                    main.compatible_chat_endpoint("ollama", "qwen3:4b")
        with patch.dict(main.os.environ, {
            "OLLAMA_BASE_URL": "https://ollama.example.com/v1",
            "OLLAMA_ACCESS_CLIENT_ID": "access-id",
            "OLLAMA_ACCESS_CLIENT_SECRET": "access-secret",
        }, clear=True):
            self.assertEqual(
                main.compatible_chat_endpoint("ollama", "qwen3:4b"),
                "https://ollama.example.com/v1/chat/completions",
            )

    def test_remote_ollama_proxy_key_configures_model_without_access_credentials(self):
        with patch.dict(main.os.environ, {
            "OLLAMA_BASE_URL": "https://example.trycloudflare.com/v1",
            "OLLAMA_API_KEY": "proxy-secret",
            "OLLAMA_MODEL": "qwen3:4b",
            "AI_MODEL_ORDER": "ollama:qwen3:4b",
        }, clear=True):
            models = main.configured_ai_models()
            endpoint = main.compatible_chat_endpoint("ollama", "qwen3:4b")
        self.assertEqual(endpoint, "https://example.trycloudflare.com/v1/chat/completions")
        self.assertEqual([(model[0], model[3]) for model in models], [("ollama:qwen3:4b", "proxy-secret")])

    def test_ollama_adds_access_headers_only_for_remote_calls_and_uses_capacity_slot(self):
        response = self.response()
        with patch.dict(main.os.environ, {
            "OLLAMA_BASE_URL": "https://ollama.example.com/v1",
            "OLLAMA_ACCESS_CLIENT_ID": "access-id",
            "OLLAMA_ACCESS_CLIENT_SECRET": "access-secret",
        }, clear=True), patch.object(main, "post_chat_completion", return_value=response) as post:
            main.generate_with_provider("ollama", "qwen3:4b", "ollama", "Read source.", {"type": "object"}, 800)
        self.assertEqual(post.call_args.args[0], "ollama")
        self.assertEqual(post.call_args.kwargs["headers"]["CF-Access-Client-Id"], "access-id")
        self.assertEqual(post.call_args.kwargs["headers"]["CF-Access-Client-Secret"], "access-secret")
        self.assertEqual(post.call_args.kwargs["payload"]["model"], "qwen3:4b")
        self.assertEqual(post.call_args.kwargs["payload"]["max_tokens"], 800)

    def test_ollama_busy_slot_fails_fast_instead_of_waiting(self):
        import threading

        slots = threading.BoundedSemaphore(1)
        slots.acquire()
        with patch.object(main, "_ollama_request_slots", slots), patch.object(
            main, "post_provider_json", side_effect=AssertionError("A busy local slot must not send a request")
        ):
            with self.assertRaises(main.ProviderError) as error:
                main.post_chat_completion("ollama", "http://localhost:11434/v1/chat/completions", {}, {})
        self.assertEqual(error.exception.error_code, "local_capacity")

    def test_retired_openrouter_qwen_route_is_not_configured(self):
        environment = {
            "OPENROUTER_API_KEY": "openrouter-test",
            "AI_MODEL_ORDER": "openrouter:qwen/qwen3.8-27b:free,openrouter:google/gemma-4-26b-a4b-it:free",
        }
        with patch.dict(main.os.environ, environment, clear=True):
            models = main.configured_ai_models()
        self.assertEqual([model[0] for model in models], ["openrouter:google/gemma-4-26b-a4b-it:free"])

    def test_cloudflare_needs_valid_account_id_in_addition_to_token(self):
        for value in ("", "../other-account", "x" * 32, "https://attacker.example"):
            with self.subTest(account_id=value), patch.dict(main.os.environ, {"CLOUDFLARE_API_TOKEN": "cf-test", "CLOUDFLARE_ACCOUNT_ID": value}, clear=True):
                self.assertEqual(main.configured_ai_models(), [])
                with self.assertRaises(main.ProviderError):
                    main.compatible_chat_endpoint("cloudflare", "test")

    def test_existing_environment_aliases_are_server_side(self):
        environment = {
            "AI_GATEWAY_API_KEY": "gateway-alias",
            "TYPHOON_OCR_API_KEY": "typhoon-alias",
            "AI_MODEL_ORDER": "vercel:nvidia/nemotron-3.5-lightning-free,typhoon:typhoon-v2.5-30b-a3b-instruct",
        }
        with patch.dict(main.os.environ, environment, clear=True):
            models = main.configured_ai_models()
        keys = {provider: key for _id, provider, _model, key, _label in models}
        self.assertEqual(keys, {"vercel": "gateway-alias", "typhoon": "typhoon-alias"})

    def test_new_vision_models_receive_labeled_pixels_and_correct_endpoints(self):
        data_url = "data:image/png;base64,aGVsbG8="
        cases = (
            ("cloudflare", "@cf/google/gemma-4-26b-a4b-it", "https://api.cloudflare.com/client/v4/accounts/" + "a" * 32 + "/ai/v1/chat/completions"),
            ("vercel", "google/gemma-4-26b-a4b-it", "https://ai-gateway.vercel.sh/v1/chat/completions"),
        )
        for provider, model, endpoint in cases:
            with self.subTest(provider=provider), patch.dict(main.os.environ, {"CLOUDFLARE_ACCOUNT_ID": "a" * 32}), patch.object(main, "post_provider_json", return_value=self.response()) as post:
                token = main._provider_images.set((("Figure 1-4", data_url),))
                try:
                    result = main.generate_with_provider(provider, model, "only-this-key", "Read the source.", {"type": "object"}, 1200)
                finally:
                    main._provider_images.reset(token)
            self.assertEqual(result["title"], "Source material")
            self.assertEqual(post.call_args.args[0], endpoint)
            self.assertEqual(post.call_args.kwargs["headers"]["Authorization"], "Bearer only-this-key")
            content = post.call_args.kwargs["payload"]["messages"][0]["content"]
            self.assertEqual(content[-2], {"type": "text", "text": "Figure 1-4"})
            self.assertEqual(content[-1], {"type": "image_url", "image_url": {"url": data_url}})
            self.assertEqual(post.call_args.kwargs["payload"]["response_format"], {"type": "json_object"})

    def test_text_models_are_not_mislabeled_as_vision_or_ocr(self):
        for provider, model in (("cloudflare", "@cf/nvidia/nemotron-3-120b-a12b"), ("vercel", "nvidia/nemotron-3.5-lightning-free"), ("vercel", "openai/gpt-oss-120b"), ("typhoon", "typhoon-v2.5-30b-a3b-instruct")):
            self.assertFalse(main.provider_supports_images(provider, model))
        self.assertNotIn("typhoon:typhoon-ocr", main.AI_MODELS)

    def test_typhoon_uses_documented_text_api_without_unsupported_json_parameter(self):
        with patch.object(main, "post_provider_json", return_value=self.response()) as post:
            main.generate_with_provider("typhoon", "typhoon-v2.5-30b-a3b-instruct", "typhoon-only", "Read the source.", {"type": "object", "required": ["title", "items"]}, 1200)
        self.assertEqual(post.call_args.args[0], "https://api.opentyphoon.ai/v1/chat/completions")
        payload = post.call_args.kwargs["payload"]
        self.assertNotIn("response_format", payload)
        self.assertIn('"required": ["title", "items"]', payload["messages"][0]["content"])

    def test_provider_limits_are_reported_for_existing_fallback(self):
        with patch.object(main, "post_provider_json", return_value=self.response(429)):
            with self.assertRaises(main.ProviderError) as error:
                main.generate_with_provider("vercel", "nvidia/nemotron-3.5-lightning-free", "secret-test-key", "Read source.", {}, 1200)
        self.assertEqual(error.exception.status, 429)
        self.assertEqual(main.provider_failure_reason(error.exception), "limit")
        self.assertNotIn("secret-test-key", str(error.exception))
        self.assertNotIn("private prompt", str(error.exception))

    def test_gpt_oss_uses_low_reasoning_and_validated_json_object_mode(self):
        schema = {"type": "object", "properties": {"title": {"type": "string"}, "items": {"type": "array", "items": {
            "type": "object", "properties": {"source_evidence": {"type": "string"}}
        }}}}
        with patch.object(main, "post_provider_json", return_value=self.response()) as post:
            main.generate_with_provider("groq", "openai/gpt-oss-20b", "groq-test", "Read source.", schema, 3000)
        payload = post.call_args.kwargs["payload"]
        self.assertEqual(payload["response_format"], {"type": "json_object"})
        self.assertEqual(payload["reasoning_effort"], "low")
        self.assertEqual(payload["max_completion_tokens"], 3000)
        self.assertIn("answer and correct_answer must be the exact same option text", payload["messages"][0]["content"])

    def test_gpt_oss_can_fill_a_thirty_question_set_in_small_batches(self):
        model = ("groq:openai/gpt-oss-20b", "groq", "openai/gpt-oss-20b", "groq-test", "GPT-OSS 20B")
        question_number = 0
        batch_sizes = []

        def generate(_provider, _model, _key, _prompt, request_schema, max_tokens):
            nonlocal question_number
            batch = request_schema["properties"]["items"]["maxItems"]
            batch_sizes.append((batch, max_tokens))
            items = []
            for _ in range(batch):
                question_number += 1
                items.append({"question": f"Question {question_number}?", "answer": f"Answer {question_number}"})
            return {"title": "Study set", "items": items}

        schema = {"type": "object", "properties": {"title": {"type": "string"}, "items": {
            "type": "array", "items": {"type": "object", "properties": {"question": {"type": "string"}, "answer": {"type": "string"}}}
        }}}
        with patch.object(main, "configured_ai_models", return_value=[model]), patch.object(main, "generate_with_provider", side_effect=generate):
            payload, used, fallback, incomplete = main.generate_with_fallback(
                lambda count, _completed: f"Create exactly {count} questions.", schema, model[0], 30,
                study_format="flashcards",
            )

        self.assertEqual(len(payload["items"]), 30)
        self.assertEqual(used, [model[0]])
        self.assertIsNone(fallback)
        self.assertFalse(incomplete)
        self.assertEqual([batch for batch, _ in batch_sizes], [2] * 15)
        self.assertEqual([tokens for _, tokens in batch_sizes], [1800] * 15)

    def test_groq_model_budgets_fit_the_observed_free_tier_limits(self):
        self.assertEqual(main.generation_batch_size("groq", "openai/gpt-oss-120b", 100), 2)
        self.assertEqual(main.generation_max_tokens("groq", "openai/gpt-oss-120b", 2), 1800)
        self.assertEqual(main.generation_batch_size("groq", "qwen/qwen3.8-27b", 100), 1)
        self.assertEqual(main.generation_max_tokens("groq", "qwen/qwen3.8-27b", 1), 850)

    def test_voice_tutor_can_use_every_new_provider(self):
        for provider, model in (("cloudflare", "@cf/nvidia/nemotron-3-120b-a12b"), ("vercel", "nvidia/nemotron-3.5-lightning-free"), ("typhoon", "typhoon-v2.5-30b-a3b-instruct")):
            response = Mock(ok=True)
            response.json.return_value = {"choices": [{"message": {"content": "Study reply"}}]}
            with self.subTest(provider=provider), patch.dict(main.os.environ, {"CLOUDFLARE_ACCOUNT_ID": "a" * 32}), patch.object(main, "post_provider_json", return_value=response) as post:
                self.assertEqual(main.generate_voice_reply(provider, model, "voice-key", "Help study.", [], "Hi"), "Study reply")
            self.assertEqual(post.call_args.kwargs["headers"]["Authorization"], "Bearer voice-key")


    def test_voice_calls_use_the_protected_ollama_route_too(self):
        response = self.response()
        environment = {
            "OLLAMA_BASE_URL": "https://ollama.example.com/v1",
            "OLLAMA_ACCESS_CLIENT_ID": "access-id",
            "OLLAMA_ACCESS_CLIENT_SECRET": "access-secret",
        }
        with patch.dict(main.os.environ, environment, clear=True), patch.object(
            main, "post_chat_completion", return_value=response
        ) as post:
            answer = main.generate_voice_reply(
                "ollama", "qwen3:4b", "ollama", "You are a study tutor.", [], "Help me.")
        self.assertIn("A supported fact", answer)
        self.assertEqual(post.call_args.args[0], "ollama")
        self.assertEqual(post.call_args.kwargs["headers"]["CF-Access-Client-Id"], "access-id")
        self.assertEqual(post.call_args.kwargs["headers"]["CF-Access-Client-Secret"], "access-secret")


if __name__ == "__main__":
    unittest.main()
