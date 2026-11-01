import copy
import unittest
from unittest.mock import patch

from fastapi import FastAPI
from fastapi.testclient import TestClient

import accounts
import social_api
import social_store as store


class ProfileThemeTests(unittest.TestCase):
    def setUp(self):
        self.tables = {name: [] for name in accounts.SOCIAL_TABLES}
        self.tables["Profiles"].append({
            "user_id": "student", "nickname": "Student", "avatar_id": "kuromi",
            "gender": "prefer-not-to-say", "theme": "dark", "discoverable": "false",
            "companion_id": "cat", "companion_name": "Miso", "public_key_json": "",
            "onboarding_version": store.TERMS_VERSION, "terms_version": store.TERMS_VERSION,
        })
        def write(tab, row, number=None):
            if number is None:
                self.tables[tab].append(copy.deepcopy(row))
            else:
                self.tables[tab][number - 2] = copy.deepcopy(row)
            return row
        patches = [
            patch.object(store, "rows", side_effect=lambda tab: [(index + 2, dict(row)) for index, row in enumerate(self.tables[tab])]),
            patch.object(store, "write", side_effect=write),
        ]
        for item in patches:
            item.start()
            self.addCleanup(item.stop)
        social_api.LIMITS.clear()
        app = FastAPI()
        app.include_router(social_api.create_router(lambda: {"user_id": "student"}, lambda *_: None))
        self.client = TestClient(app)
        self.addCleanup(self.client.close)

    @staticmethod
    def body(theme):
        return {"nickname": "Student", "avatar_id": "kuromi", "gender": "prefer-not-to-say", "theme": theme, "companion_id": "cat", "companion_name": "Miso"}

    def test_all_ten_themes_round_trip_to_storage_and_bootstrap(self):
        self.assertEqual(len(store.THEME_IDS), 10)
        for theme in store.THEME_IDS:
            with self.subTest(theme=theme):
                result = self.client.put("/api/community/profile", json=self.body(theme))
                self.assertEqual(result.status_code, 200, result.text)
                self.assertEqual(result.json()["theme"], theme)
                self.assertEqual(self.tables["Profiles"][0]["theme"], theme)
                self.assertEqual(self.client.get("/api/community/bootstrap").json()["profile"]["theme"], theme)

    def test_legacy_input_is_accepted_and_saved_canonically(self):
        for legacy, canonical in store.LEGACY_THEMES.items():
            with self.subTest(theme=legacy):
                result = self.client.put("/api/community/profile", json=self.body(legacy))
                self.assertEqual(result.status_code, 200, result.text)
                self.assertEqual(result.json()["theme"], canonical)
                self.assertEqual(self.tables["Profiles"][0]["theme"], canonical)

    def test_legacy_reads_are_normalized_without_writing(self):
        for legacy, canonical in store.LEGACY_THEMES.items():
            with self.subTest(theme=legacy):
                self.tables["Profiles"][0]["theme"] = legacy
                self.assertEqual(store.profile("student")["theme"], canonical)
                self.assertEqual(self.client.get("/api/community/bootstrap").json()["profile"]["theme"], canonical)
                self.assertEqual(self.tables["Profiles"][0]["theme"], legacy)
                store.write.assert_not_called()

    def test_missing_empty_or_unknown_stored_themes_default_to_kuromi_dark(self):
        for theme in (None, "", "old-unknown-theme"):
            with self.subTest(theme=theme):
                if theme is None:
                    self.tables["Profiles"][0].pop("theme", None)
                else:
                    self.tables["Profiles"][0]["theme"] = theme
                result = self.client.get("/api/community/bootstrap")
                self.assertEqual(result.status_code, 200, result.text)
                self.assertEqual(result.json()["profile"]["theme"], "kuromi-dark")

    def test_non_theme_profile_save_also_migrates_legacy_theme(self):
        self.tables["Profiles"][0]["theme"] = "rose"
        result = store.save_profile("student", {"nickname": "Renamed"})
        self.assertEqual(result["theme"], "hello-kitty-light")
        self.assertEqual(self.tables["Profiles"][0]["theme"], "hello-kitty-light")

    def test_invalid_update_themes_are_rejected_before_storage(self):
        for theme in ("", "kuromi", "Kuromi-dark", "rose-dark", "pochacco-blue", None, 1):
            with self.subTest(theme=theme):
                result = self.client.put("/api/community/profile", json=self.body(theme))
                self.assertEqual(result.status_code, 422, result.text)
        store.write.assert_not_called()
        self.assertEqual(self.tables["Profiles"][0]["theme"], "dark")


if __name__ == "__main__":
    unittest.main()
