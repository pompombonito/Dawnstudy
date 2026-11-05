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

    def test_keys_opt_in_providers_and_append_after_older_model_order(self):
        environment = {"GROQ_API_KEY": "groq-test", "CLOUDFLARE_API_TOKEN": "cf-test",
                       "CLOUDFLARE_ACCOUNT_ID": "a" * 32, "VERCEL_AI_GATEWAY_API_KEY": "vercel-test",
                       "TYPHOON_API_KEY": "typhoon-test", "AI_MODEL_ORDER": "groq:openai/gpt-oss-120b"}
        with patch.dict(main.os.environ, environment, clear=True), patch.object(main.requests, "get", side_effect=AssertionError("No startup requests")):
            models = main.configured_ai_models()
        self.assertEqual(models[0][0], "groq:openai/gpt-oss-120b")
        keys = {provider: key for _id, provider, _model, key, _label in models}
        self.assertEqual(keys, {"groq": "groq-test", "cloudflare": "cf-test", "vercel": "vercel-test", "typhoon": "typhoon-test"})
        with patch.dict(main.os.environ, {}, clear=True):
            self.assertEqual(main.configured_ai_models(), [])

    def test_cloudflare_needs_valid_account_id_in_addition_to_token(self):
        for value in ("", "../other-account", "x" * 32, "https://attacker.example"):
            with self.subTest(account_id=value), patch.dict(main.os.environ, {"CLOUDFLARE_API_TOKEN": "cf-test", "CLOUDFLARE_ACCOUNT_ID": value}, clear=True):
                self.assertEqual(main.configured_ai_models(), [])
                with self.assertRaises(main.ProviderError):
                    main.compatible_chat_endpoint("cloudflare", "test")

    def test_existing_environment_aliases_are_server_side(self):
        with patch.dict(main.os.environ, {"AI_GATEWAY_API_KEY": "gateway-alias", "TYPHOON_OCR_API_KEY": "typhoon-alias"}, clear=True):
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
        self.assertEqual([batch for batch, _ in batch_sizes], [4, 4, 4, 4, 4, 4, 4, 2])
        self.assertEqual([tokens for _, tokens in batch_sizes], [3000] * 8)

    def test_voice_tutor_can_use_every_new_provider(self):
        for provider, model in (("cloudflare", "@cf/nvidia/nemotron-3-120b-a12b"), ("vercel", "nvidia/nemotron-3.5-lightning-free"), ("typhoon", "typhoon-v2.5-30b-a3b-instruct")):
            response = Mock(ok=True)
            response.json.return_value = {"choices": [{"message": {"content": "Study reply"}}]}
            with self.subTest(provider=provider), patch.dict(main.os.environ, {"CLOUDFLARE_ACCOUNT_ID": "a" * 32}), patch.object(main, "post_provider_json", return_value=response) as post:
                self.assertEqual(main.generate_voice_reply(provider, model, "voice-key", "Help study.", [], "Hi"), "Study reply")
            self.assertEqual(post.call_args.kwargs["headers"]["Authorization"], "Bearer voice-key")


if __name__ == "__main__":
    unittest.main()
