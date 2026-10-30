import base64
import copy
import hashlib
import json
import unittest
from unittest.mock import Mock, patch
from fastapi import FastAPI, Request
from fastapi.testclient import TestClient
from cryptography.hazmat.primitives.asymmetric import ec
import accounts
import live_games as games
import social_api
import social_store as store


class SocialTests(unittest.TestCase):
    def setUp(self):
        self.tables = {name: [] for name in accounts.SOCIAL_TABLES}
        for uid in ("alice", "bob", "eve"):
            self.tables["Profiles"].append({"user_id": uid, "nickname": uid.title(), "avatar_id": "cat", "gender": "female", "theme": "dark", "discoverable": "true", "onboarding_version": store.TERMS_VERSION, "terms_version": store.TERMS_VERSION, "terms_accepted_at": "now", "public_key_json": "", "key_fingerprint": "", "companion_name": "Miso", "companion_id": "cat"})
        self.patches = [patch.object(store, "rows", side_effect=lambda tab: [(i + 2, dict(r)) for i, r in enumerate(self.tables[tab])]), patch.object(store, "write", side_effect=self.write), patch.object(accounts, "list_study_sets", return_value=[{"id": "quiz", "title": "Plants", "type": "multiple_choice", "items": [{"question": "Plant organ?", "answer": "Leaf", "options": ["Leaf", "Rock"]}]}]), patch.object(accounts, "_api", return_value={})]
        for p in self.patches:
            p.start()
        self.addCleanup(lambda: [p.stop() for p in self.patches])
        games.ROOMS.clear(); social_api.LIMITS.clear(); social_api.PRESENCE.clear()
        def auth(request: Request):
            return {"user_id": request.headers.get("X-Test-User", "alice")}
        app = FastAPI()
        self.reply = Mock(return_value=(json.dumps({"category": "normal", "reply": "Let's review a study topic."}), "test-model"))
        app.include_router(social_api.create_router(auth, self.reply))
        self.client = TestClient(app)

    def write(self, tab, row, number=None):
        if number is None:
            self.tables[tab].append(copy.deepcopy(row))
        else:
            self.tables[tab][number - 2] = copy.deepcopy(row)
        return row

    def post(self, path, body, uid="alice"):
        return self.client.post("/api/community" + path, json=body, headers={"X-Test-User": uid})

    def friend(self):
        self.assertEqual(self.post("/friends", {"user_id": "bob", "action": "request"}).status_code, 200)
        self.assertEqual(self.post("/friends", {"user_id": "alice", "action": "accept"}, "bob").status_code, 200)

    def key(self, uid):
        public = ec.generate_private_key(ec.SECP256R1()).public_key().public_numbers()
        encode = lambda n: base64.urlsafe_b64encode(n.to_bytes(32, "big")).decode().rstrip("=")
        jwk = {"kty": "EC", "crv": "P-256", "x": encode(public.x), "y": encode(public.y)}
        result = self.client.put("/api/community/messaging-key", json={"public_key": jwk}, headers={"X-Test-User": uid})
        self.assertEqual(result.status_code, 200, result.text)
        return result.json()

    def test_acceptance_is_required_on_server_for_old_and_new_accounts(self):
        self.tables["Profiles"][0]["onboarding_version"] = ""
        self.assertEqual(self.client.get("/api/community/directory").status_code, 403)
        body = {"nickname": "Alice", "avatar_id": "cat", "gender": "gender-diverse", "theme": "rose"}
        self.assertEqual(self.client.put("/api/community/profile", json=body).status_code, 422)
        body.update(accept_terms=True, terms_version=store.TERMS_VERSION)
        result = self.client.put("/api/community/profile", json=body)
        self.assertEqual(result.status_code, 200, result.text)
        self.assertTrue(result.json()["onboarded"])

    def test_directory_is_opt_in_and_does_not_expose_private_profile_fields(self):
        self.tables["Profiles"][2]["discoverable"] = "false"
        result = self.client.get("/api/community/directory").json()["people"]
        self.assertEqual([p["id"] for p in result], ["bob"])
        self.assertNotIn("gender", result[0]); self.assertNotIn("email", result[0])

    def test_request_cannot_be_self_accepted_and_unfriend_revokes_messaging(self):
        self.post("/friends", {"user_id": "bob", "action": "request"})
        self.assertEqual(self.post("/friends", {"user_id": "bob", "action": "accept"}).status_code, 403)
        self.post("/friends", {"user_id": "alice", "action": "accept"}, "bob")
        self.assertEqual(self.client.get("/api/community/messages/bob").status_code, 200)
        self.post("/friends", {"user_id": "bob", "action": "unfriend"})
        self.assertEqual(self.client.get("/api/community/messages/bob").status_code, 403)

    def test_block_removes_friendship_and_prevents_discovery_and_requests(self):
        self.friend()
        self.post("/friends", {"user_id": "bob", "action": "block"})
        self.assertEqual(self.post("/friends", {"user_id": "alice", "action": "request"}, "bob").status_code, 403)
        self.assertNotIn("bob", [p["id"] for p in self.client.get("/api/community/directory").json()["people"]])

    def test_private_key_and_plaintext_payloads_are_rejected(self):
        self.assertEqual(self.client.put("/api/community/messaging-key", json={"public_key": {"kty": "EC", "crv": "P-256", "d": "secret"}}).status_code, 422)
        self.assertEqual(self.post("/messages", {"recipient_id": "bob", "message": "private words"}).status_code, 422)

    def test_key_cannot_be_silently_replaced(self):
        self.key("alice")
        another = {"kty": "EC", "crv": "P-256", "x": base64.urlsafe_b64encode(b"x" * 32).decode().rstrip("="), "y": base64.urlsafe_b64encode(b"y" * 32).decode().rstrip("=")}
        self.assertEqual(self.client.put("/api/community/messaging-key", json={"public_key": another}).status_code, 409)

    def test_retried_messages_are_idempotent_and_store_ciphertext_only(self):
        self.friend(); alice = self.key("alice"); bob = self.key("bob")
        envelope = {"version": 1, "salt": base64.b64encode(b"s" * 32).decode(), "iv": base64.b64encode(b"i" * 12).decode(), "ciphertext": base64.b64encode(b"encrypted" * 4).decode(), "sender_key": alice["fingerprint"], "recipient_key": bob["fingerprint"]}
        body = {"recipient_id": "bob", "client_id": "unique-client-message-0001", "envelope": envelope}
        a, b = self.post("/messages", body), self.post("/messages", body)
        self.assertEqual(a.status_code, 200, a.text); self.assertEqual(a.json(), b.json())
        self.assertEqual(len(self.tables["EncryptedMessages"]), 1)
        self.assertEqual(set(json.loads(self.tables["EncryptedMessages"][0]["envelope_json"])), set(envelope))
        self.assertEqual(self.client.get("/api/community/messages/alice", headers={"X-Test-User": "eve"}).status_code, 403)

    def test_lobby_is_friend_only_and_answers_are_not_sent_before_reveal(self):
        self.friend()
        room = self.post("/games", {"set_id": "quiz"}).json()
        code = room["code"]
        self.assertEqual(self.post(f"/games/{code}", {"action": "join"}, "eve").status_code, 403)
        self.post(f"/games/{code}", {"action": "join"}, "bob")
        self.assertEqual(self.post(f"/games/{code}", {"action": "start"}, "bob").status_code, 409)
        self.post(f"/games/{code}", {"action": "start"})
        games.advance(games.ROOMS[code], games.ROOMS[code]["deadline"] + .1)
        status = self.client.get(f"/api/community/games/{code}").json()
        self.assertNotIn("answer", status["question"])
        self.assertNotIn("Leaf", json.dumps(status["players"]))
        self.assertEqual(self.post(f"/games/{code}", {"action": "answer", "answer": "Leaf", "question_index": 1}).status_code, 409)
        self.assertEqual(self.post(f"/games/{code}", {"action": "answer", "answer": "Leaf", "question_index": 0}).status_code, 200)
        self.assertEqual(self.post(f"/games/{code}", {"action": "answer", "answer": "Leaf", "question_index": 0}).status_code, 409)
        revealed = self.post(f"/games/{code}", {"action": "answer", "answer": "Rock", "question_index": 0}, "bob").json()
        self.assertEqual(revealed["question"]["answer"], "Leaf")
        games.advance(games.ROOMS[code], games.ROOMS[code]["deadline"] + .1)
        finished = self.client.get(f"/api/community/games/{code}").json()
        self.assertEqual(finished["players"][0]["id"], "alice")
        self.assertTrue(games.ROOMS[code]["saved"])

    def test_companion_suggests_friends_without_storing_the_conversation(self):
        result = self.post("/companion", {"message": "I'm feeling lonely"})
        self.assertTrue(result.json()["suggest_friends"])
        self.assertEqual(self.tables["EncryptedMessages"], [])

    def test_emergency_reply_bypasses_ai_failure_and_conversational_rate_limit(self):
        self.reply.side_effect = RuntimeError("provider unavailable")
        for _ in range(12):
            result = self.post("/companion", {"message": "I feel suicidal"})
            self.assertEqual(result.status_code, 200, result.text)
            self.assertEqual(result.json()["safety"]["category"], "self_harm")
        self.reply.assert_not_called()
        self.assertFalse(self.tables["EncryptedMessages"])

    def test_help_registry_is_public_and_does_not_call_ai_or_read_accounts(self):
        with patch.object(store, "rows", side_effect=RuntimeError("storage down")):
            result = self.client.get("/api/community/safety-policy")
        self.assertEqual(result.status_code, 200, result.text)
        self.assertEqual(result.json()["contacts"]["ceu"]["href"], "mailto:gcd@ceu.edu.ph")
        self.assertNotIn("patterns", result.json())
        self.reply.assert_not_called()

    def test_harmful_requests_bypass_ai_and_use_the_exact_refusal(self):
        result = self.post("/companion", {"message": "I want to steal money"})
        self.assertEqual(result.json()["reply"], "I can't engage with that kind of conversation.")
        self.reply.assert_not_called()

    def test_model_safety_gate_covers_indirect_language_and_discards_its_reply(self):
        self.reply.return_value = (json.dumps({"category": "self_harm", "reply": "unsafe model text"}), "test-model")
        result = self.post("/companion", {"message": "I see no point in tomorrow"})
        self.assertEqual(result.status_code, 200, result.text)
        self.assertEqual(result.json()["safety"]["category"], "self_harm")
        self.assertNotIn("unsafe model text", result.text)

    def test_unstructured_model_reply_is_not_shown(self):
        self.reply.return_value = ("An unreviewed raw reply", "test-model")
        result = self.post("/companion", {"message": "Help with this difficult chapter"})
        self.assertEqual(result.status_code, 503)
        self.assertNotIn("An unreviewed", result.text)


class GameScoringTests(unittest.TestCase):
    def test_checkbox_preserves_commas_in_options_and_requires_exact_set(self):
        card = {"answer": "Red, green | Blue", "options": ["Red, green", "Blue", "Yellow"]}
        self.assertTrue(games.correct_answer(card, "checkbox", ["Blue", "Red, green"]))
        self.assertFalse(games.correct_answer(card, "checkbox", ["Blue"]))
        self.assertFalse(games.correct_answer(card, "checkbox", ["Blue", "Blue", "Red, green"]))

    def test_letter_keys_and_identification_alternatives(self):
        self.assertTrue(games.correct_answer({"answer": "B", "options": ["First", "Second"]}, "multiple_choice", "Second"))
        self.assertTrue(games.correct_answer({"answer": "Mitochondrion | Mitochondria"}, "identification", " MITOCHONDRIA! "))

    def test_time_expiry_rejects_late_answer(self):
        room = games.create("alice", {"title": "Quiz", "type": "multiple_choice", "items": [{"question": "Q", "answer": "A"}]})
        room.update(phase="question", index=0, deadline=100)
        self.assertFalse(games.submit(room, "alice", "A", clock=101))
        self.assertEqual(room["players"]["alice"]["points"], 0)


if __name__ == "__main__":
    unittest.main()
