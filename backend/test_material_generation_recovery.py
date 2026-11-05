"""Exercise quota recovery and source coverage without consuming API credits."""
import json
import unittest
from unittest.mock import Mock, patch

from test_generation_limits import main
from material_batches import source_windows


class RecoveryTests(unittest.TestCase):
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


if __name__ == "__main__":
    unittest.main()
