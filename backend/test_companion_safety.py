import json
import unittest
from pathlib import Path
from companion_safety import classify, response, resolve_model_reply, POLICY, REFUSAL, system_prompt


class CompanionSafetyTests(unittest.TestCase):
    def test_shared_english_filipino_context_and_false_positive_fixtures(self):
        cases = json.loads(Path(__file__).with_name("companion_safety_cases.json").read_text(encoding="utf-8"))
        for case in cases:
            with self.subTest(message=case["message"]):
                self.assertEqual(classify(case["message"], case.get("history", [])), case["expected"])

    def test_contact_registry_only_contains_verified_links_and_user_supplied_email(self):
        self.assertEqual(POLICY["contacts"]["emergency"]["href"], "tel:911")
        self.assertEqual(POLICY["contacts"]["ncmh"]["label"], "1800-1888-1553")
        self.assertEqual(POLICY["contacts"]["ncmh"]["href"], "tel:+63180018881553?oai_link_source=model_response_hotline")
        self.assertEqual(POLICY["contacts"]["ceu"]["href"], "mailto:gcd@ceu.edu.ph")

    def test_harmful_and_violent_intent_use_exact_requested_refusal(self):
        self.assertEqual(REFUSAL, "I can't engage with that kind of conversation.")
        self.assertEqual(response("harmful_request")["reply"], REFUSAL)
        self.assertEqual(response("violent_intent")["reply"], REFUSAL)
        self.assertTrue(response("violent_intent")["safety"]["emergency"])

    def test_emergency_contacts_take_priority_over_study_friend_suggestions(self):
        for category in ("self_harm", "violent_intent", "medical_emergency", "immediate_danger"):
            result = response(category)
            self.assertFalse(result["suggest_friends"])
            self.assertIn("emergency", result["safety"]["contacts"])
            self.assertIn("ceu", result["safety"]["contacts"])

    def test_model_categories_cover_unenumerated_messages_without_displaying_unsafe_output(self):
        for category in POLICY["responses"]:
            result = resolve_model_reply(json.dumps({"category": category, "reply": "unsafe provider content must not appear"}), "test")
            self.assertEqual(result, response(category))

    def test_invalid_model_output_never_passes_through(self):
        for raw in ("raw unsafe text", '{"category":"normal","reply":""}', '{"category":"unknown","reply":"anything"}', "[]", "null", '{"category":[],"reply":"bad"}', '{"category":"normal","reply":42}'):
            with self.subTest(raw=raw):
                self.assertIsNone(resolve_model_reply(raw, "test"))

    def test_model_cannot_invent_phone_numbers_or_therapist_roles(self):
        for reply, expected in (("Call 1234567 for my hotline", "resources"), ("Tumawag sa 1234567.", "resources"), ("As your therapist, let's explore your trauma.", "clinical_boundary"), ("You have depression.", "clinical_boundary"), ("May depresyon ka.", "clinical_boundary")):
            result = resolve_model_reply(json.dumps({"category": "normal", "reply": reply}), "test")
            self.assertEqual(result, response(expected))

    def test_normal_study_conversation_and_fenced_json_still_work(self):
        result = resolve_model_reply('```json\n{"category":"normal","reply":"Let’s review one concept at a time. What topic are you studying?"}\n```', "configured-model")
        self.assertIsNone(result["safety"])
        self.assertEqual(result["model"], "configured-model")
        self.assertIn("What topic", result["reply"])

    def test_prompt_requires_nonclinical_behavior_and_contextual_safety_classification(self):
        prompt = system_prompt("Miso")
        self.assertIn("not a human, therapist", prompt)
        self.assertIn("Return ONLY a JSON", prompt)
        self.assertIn("victim asking for help", prompt)
        self.assertIn("unauthorized hacking", prompt)


if __name__ == "__main__":
    unittest.main()
