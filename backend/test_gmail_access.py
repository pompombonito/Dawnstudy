import unittest
from unittest.mock import patch
from fastapi.testclient import TestClient
from fastapi.security import HTTPAuthorizationCredentials
from test_generation_limits import main
import accounts


class GmailAccessTests(unittest.TestCase):
    def test_gmail_and_existing_ceu_domains_are_allowed(self):
        for address in ("any.student@gmail.com", " Any.Student+quiz@GMAIL.COM ", "student@ceu.edu.ph", "student@mnl.ceu.edu.ph", "student@mkt.ceu.edu.ph", "student@mls.ceu.edu.ph"):
            self.assertTrue(main.is_allowed_email(address), address)

    def test_domain_spoofing_and_malformed_addresses_are_rejected(self):
        for address in ("@gmail.com", "user@@gmail.com", "user@gmail.com.attacker.net", "user@evilgmail.com", "user@sub.gmail.com", "a b@gmail.com", "user@yahoo.com", ""):
            self.assertFalse(main.is_allowed_email(address), address)

    def test_google_signin_and_protected_requests_accept_ordinary_gmail(self):
        user = {"user_id": "ordinary-gmail", "email": "ordinary@gmail.com", "display_name": "Student", "username": "student"}
        with patch.object(main, "verify_google_credential", return_value={**user, "google_sub": "google-id"}), patch.object(main, "find_user_by_google_sub", return_value=(2, user)), patch.object(main, "create_session", return_value="session"):
            result = TestClient(main.app).post("/api/auth/google", json={"credential": "verified-test-token-123456"})
        self.assertEqual(result.status_code, 200, result.text)
        self.assertEqual(result.json()["user"]["email"], user["email"])
        with patch.object(main, "verify_session", return_value=user["user_id"]), patch.object(main, "find_user_by_id", return_value=user):
            self.assertEqual(main.authenticated_user(HTTPAuthorizationCredentials(scheme="Bearer", credentials="session")), user)

    def test_unverified_google_email_still_rejected(self):
        with patch.dict("os.environ", {"GOOGLE_CLIENT_ID": "test-client"}), patch.object(accounts.id_token, "verify_oauth2_token", return_value={"email": "student@gmail.com", "email_verified": False, "sub": "subject"}):
            with self.assertRaisesRegex(accounts.StorageError, "verified email"):
                accounts.verify_google_credential("credential")


if __name__ == "__main__":
    unittest.main()
