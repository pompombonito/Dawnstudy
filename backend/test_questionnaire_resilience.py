import json
import unittest
from unittest.mock import Mock, patch

from test_generation_limits import main


class QuestionnaireResilienceTests(unittest.TestCase):
    def test_partial_provider_response_keeps_valid_items_and_retries_only_the_unresolved_one(self):
        models = [
            ("groq:test", "groq", "test", "groq-key", "Groq test"),
            ("zai:test", "zai", "test", "zai-key", "Z.ai test"),
        ]
        calls = []

        def provide(provider, _model, _key, prompt, _schema, _max_tokens):
            batch = json.loads(prompt.rsplit("\n", 1)[-1])
            calls.append((provider, [item["number"] for item in batch]))
            if provider == "groq":
                return {"items": [
                    {"number": item["number"], "question": item["question"],
                     "answer": item["options"][0], "uncertain": item["number"] == "2",
                     "distractors": [], "matching_pairs": []}
                    for item in batch
                ]}
            return {"items": [
                {"number": item["number"], "question": item["question"],
                 "answer": item["options"][2], "uncertain": False,
                 "distractors": [], "matching_pairs": []}
                for item in batch
            ]}

        source = "\n".join(
            f"{number}. Choose item {number}?\nA. Alpha\nB. Bravo\nC. Charlie\nD. Delta"
            for number in range(1, 4)
        )
        with patch.object(main, "configured_ai_models", return_value=models), patch.object(main, "generate_with_provider", side_effect=provide):
            items, used_models, incomplete, requested_count, unresolved = main.import_questionnaire([source], "multiple_choice", "auto")

        self.assertEqual(calls, [("groq", ["1", "2", "3"]), ("zai", ["2"])])
        self.assertEqual(len(items), 3)
        self.assertEqual([item["answer"] for item in items], ["Alpha", "Charlie", "Alpha"])
        self.assertEqual(used_models, ["groq:test", "zai:test"])
        self.assertFalse(incomplete)
        self.assertEqual(requested_count, 3)
        self.assertEqual(unresolved, [])

    def test_fifty_questions_complete_after_provider_level_fallbacks(self):
        models = []
        for provider, count in (("groq", 3), ("gemini", 5), ("openrouter", 4), ("mistral", 3)):
            for index in range(count):
                model_id = f"{provider}:test-{index}"
                models.append((model_id, provider, f"test-{index}", f"key-{provider}", f"{provider} {index}"))

        calls = []
        def provide(provider, model, _key, prompt, _schema, _max_tokens):
            calls.append((provider, model))
            if provider in {"groq", "gemini"}:
                raise main.ProviderError(provider, f"{provider}:{model}", 429, "quota exhausted")
            batch = json.loads(prompt.rsplit("\n", 1)[-1])
            return {"items": [{
                "number": item["number"], "question": item["question"], "answer": item["options"][2],
                "uncertain": False, "distractors": [], "matching_pairs": [],
            } for item in batch]}

        source = "\n".join(
            f"{number}. Which option belongs to item {number}?\nA. Alpha\nB. Bravo\nC. Charlie\nD. Delta"
            for number in range(1, 51)
        )
        with patch.object(main, "configured_ai_models", return_value=models), patch.object(main, "generate_with_provider", side_effect=provide):
            items, used_models, incomplete, requested_count, _unresolved = main.import_questionnaire([source], "multiple_choice", "auto")

        self.assertEqual(len(items), 50)
        self.assertEqual(requested_count, 50)
        self.assertFalse(incomplete)
        self.assertEqual(used_models, ["openrouter:test-0"])
        self.assertEqual(len(calls), 9)  # Two quota failures once each, then seven successful batches.
        self.assertEqual([provider for provider, _model in calls].count("groq"), 1)
        self.assertEqual([provider for provider, _model in calls].count("gemini"), 1)
        self.assertEqual([provider for provider, _model in calls].count("openrouter"), 7)
        self.assertEqual([provider for provider, _model in calls].count("mistral"), 0)

    def test_free_zai_models_are_exposed_when_the_server_key_is_set(self):
        environment = {
            "GROQ_API_KEY": "", "GEMINI_API_KEY": "", "ZAI_API_KEY": "zai-test-key",
            "OPENROUTER_API_KEY": "", "MISTRAL_API_KEY": "", "AI_MODEL_ORDER": "",
        }
        with patch.dict(main.os.environ, environment, clear=True):
            models = main.configured_ai_models()
        self.assertEqual([choice[0] for choice in models], ["zai:glm-4.7-flash", "zai:glm-4.5-flash", "zai:glm-4.6v-flash"])
        self.assertTrue(all(choice[3] == "zai-test-key" for choice in models))

    def test_zai_uses_its_openai_compatible_endpoint_and_keeps_json_parsing(self):
        response = Mock(ok=True, status_code=200)
        response.json.return_value = {"choices": [{"message": {"content": json.dumps({"title": "Test", "items": [{"question": "Q?", "answer": "A"}]})}}]}
        with patch.object(main, "post_provider_json", return_value=response) as post:
            result = main.generate_with_provider("zai", "glm-4.7-flash", "zai-test-key", "Return JSON", {"type": "object"}, 1200)
        self.assertEqual(result["items"][0]["answer"], "A")
        args, kwargs = post.call_args
        self.assertEqual(args[0], "https://api.z.ai/api/paas/v4/chat/completions")
        self.assertEqual(kwargs["headers"]["Authorization"], "Bearer zai-test-key")
        self.assertNotIn("response_format", kwargs["payload"])


if __name__ == "__main__":
    unittest.main()
