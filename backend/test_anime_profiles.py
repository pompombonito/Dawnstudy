import json
from pathlib import Path
import unittest
from unittest.mock import Mock, patch

from fastapi import FastAPI
from fastapi.testclient import TestClient

import social_api
import social_store as store


class AnimeProfileTests(unittest.TestCase):
    def setUp(self):
        self.characters = json.loads(Path(__file__).with_name("anime-characters.json").read_text(encoding="utf-8"))
        self.save_profile = Mock(side_effect=lambda uid, changes: {"user_id": uid, **changes})
        self.patches = [
            patch.object(store, "ready", return_value=True),
            patch.object(store, "save_profile", self.save_profile),
            patch.object(store, "own_profile", side_effect=lambda profile: profile),
        ]
        for value in self.patches:
            value.start()
            self.addCleanup(value.stop)
        app = FastAPI()
        app.include_router(social_api.create_router(lambda: {"user_id": "anime-test"}, Mock()))
        self.client = TestClient(app)
        self.body = {"nickname": "Student", "avatar_id": "cat", "gender": "prefer-not-to-say", "theme": "kuromi-light", "companion_id": "cat", "companion_name": "Study buddy"}
        social_api.LIMITS.clear()

    def test_every_catalog_id_can_be_saved_as_avatar_and_companion(self):
        self.assertEqual(len(self.characters), 75)
        for character in self.characters:
            with self.subTest(character=character["id"]):
                social_api.LIMITS.clear()
                result = self.client.put("/api/community/profile", json={**self.body, "avatar_id": character["id"], "companion_id": character["id"]})
                self.assertEqual(result.status_code, 200, result.text)
                self.assertEqual(result.json()["avatar_id"], character["id"])
                self.assertEqual(result.json()["companion_id"], character["id"])

    def test_unknown_anime_variants_are_rejected_without_writing_profile(self):
        original = self.characters[0]["id"]
        for field in ("avatar_id", "companion_id"):
            for identifier in (original + "-variant", original + "/extra", "anime-not-in-catalog"):
                with self.subTest(field=field, identifier=identifier):
                    result = self.client.put("/api/community/profile", json={**self.body, field: identifier})
                    self.assertEqual(result.status_code, 422, result.text)
        self.save_profile.assert_not_called()

    def test_existing_animal_and_portrait_profile_icons_remain_available(self):
        result = self.client.put("/api/community/profile", json={**self.body, "avatar_id": "portrait-female-clinical-7", "companion_id": "pompompurin"})
        self.assertEqual(result.status_code, 200, result.text)


if __name__ == "__main__":
    unittest.main()
