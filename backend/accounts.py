"""Low-volume account and study-set storage backed by Google Sheets."""

import base64
import hashlib
import hmac
import json
import os
import re
import secrets
import threading
import time
from functools import lru_cache
from typing import Any
from urllib.parse import quote

import requests
from google.auth.transport.requests import Request as GoogleAuthRequest
from google.oauth2 import id_token, service_account


SHEETS_SCOPE = "https://www.googleapis.com/auth/spreadsheets"
USERS_TAB = "Users"
SETS_TAB = "StudySets"
USER_COLUMNS = ["user_id", "username", "email", "password_hash", "google_sub", "display_name", "created_at"]
SET_COLUMNS = ["set_id", "user_id", "title", "type", "items_json", "sources_json", "created_at"]
_schema_ready = False
_schema_lock = threading.Lock()
_user_write_lock = threading.Lock()


class StorageError(RuntimeError):
    pass


def _spreadsheet_id() -> str:
    value = os.getenv("GOOGLE_SHEETS_SPREADSHEET_ID", "").strip()
    if not value:
        raise StorageError("Account storage is not configured yet. Add GOOGLE_SHEETS_SPREADSHEET_ID on Render.")
    return value


@lru_cache(maxsize=1)
def _credentials():
    raw = os.getenv("GOOGLE_SERVICE_ACCOUNT_JSON", "").strip()
    if not raw:
        raise StorageError("Account storage is not configured yet. Add GOOGLE_SERVICE_ACCOUNT_JSON on Render.")
    try:
        info = json.loads(raw)
        return service_account.Credentials.from_service_account_info(info, scopes=[SHEETS_SCOPE])
    except (ValueError, TypeError, KeyError) as exc:
        raise StorageError("GOOGLE_SERVICE_ACCOUNT_JSON is not valid service-account JSON.") from exc


def _api(method: str, path: str, *, params: dict[str, str] | None = None, body: dict[str, Any] | None = None) -> dict[str, Any]:
    try:
        credentials = _credentials()
        if not credentials.valid:
            credentials.refresh(GoogleAuthRequest())
    except StorageError:
        raise
    except Exception as exc:
        raise StorageError("Google Sheets service-account authentication failed. Check the JSON key configured on Render.") from exc
    url = f"https://sheets.googleapis.com/v4/spreadsheets/{quote(_spreadsheet_id(), safe='')}{path}"
    try:
        response = requests.request(
            method,
            url,
            headers={"Authorization": f"Bearer {credentials.token}"},
            params=params,
            json=body,
            timeout=20,
        )
    except requests.RequestException as exc:
        raise StorageError("Could not connect to the Google Sheets API.") from exc
    if response.status_code >= 400:
        raise StorageError(f"Google Sheets API returned HTTP {response.status_code}. Check that the Sheets API is enabled and the service account can edit the spreadsheet.")
    try:
        return response.json() if response.content else {}
    except ValueError as exc:
        raise StorageError("Google Sheets returned an unreadable response.") from exc


def ensure_schema() -> None:
    global _schema_ready
    if _schema_ready:
        return
    with _schema_lock:
        if _schema_ready:
            return
        metadata = _api("GET", "")
        titles = {sheet.get("properties", {}).get("title") for sheet in metadata.get("sheets", [])}
        missing = [title for title in (USERS_TAB, SETS_TAB) if title not in titles]
        if missing:
            _api("POST", ":batchUpdate", body={"requests": [{"addSheet": {"properties": {"title": title}}} for title in missing]})
        for tab, columns in ((USERS_TAB, USER_COLUMNS), (SETS_TAB, SET_COLUMNS)):
            header_range = quote(f"{tab}!A1", safe="!'")
            values = _api("GET", f"/values/{header_range}").get("values", [])
            if not values:
                _api(
                    "PUT",
                    f"/values/{header_range}",
                    params={"valueInputOption": "RAW"},
                    body={"values": [columns]},
                )
        _schema_ready = True


def _rows(tab: str, columns: list[str]) -> list[tuple[int, dict[str, str]]]:
    ensure_schema()
    range_name = quote(f"{tab}!A:{chr(64 + len(columns))}", safe="!:")
    values = _api("GET", f"/values/{range_name}").get("values", [])
    results = []
    for row_number, row in enumerate(values[1:], start=2):
        padded = list(row[: len(columns)]) + [""] * max(0, len(columns) - len(row))
        results.append((row_number, dict(zip(columns, map(str, padded)))))
    return results


def _append(tab: str, row: list[str]) -> None:
    ensure_schema()
    range_name = quote(f"{tab}!A1", safe="!:")
    _api(
        "POST",
        f"/values/{range_name}:append",
        params={"valueInputOption": "RAW", "insertDataOption": "INSERT_ROWS"},
        body={"values": [row]},
    )


def _update_user(row_number: int, user: dict[str, str]) -> None:
    range_name = quote(f"{USERS_TAB}!A{row_number}:G{row_number}", safe="!:")
    _api(
        "PUT",
        f"/values/{range_name}",
        params={"valueInputOption": "RAW"},
        body={"values": [[user.get(column, "") for column in USER_COLUMNS]]},
    )


def list_users() -> list[tuple[int, dict[str, str]]]:
    return _rows(USERS_TAB, USER_COLUMNS)


def find_user_by_username(username: str) -> tuple[int, dict[str, str]] | None:
    normalized = username.casefold()
    return next(((row_number, user) for row_number, user in list_users() if user["username"].casefold() == normalized), None)


def find_user_by_email(email: str) -> tuple[int, dict[str, str]] | None:
    normalized = email.casefold()
    return next(((row_number, user) for row_number, user in list_users() if user["email"].casefold() == normalized), None)


def find_user_by_google_sub(subject: str) -> tuple[int, dict[str, str]] | None:
    return next(((row_number, user) for row_number, user in list_users() if user["google_sub"] == subject), None)


def find_user_by_id(user_id: str) -> dict[str, str] | None:
    return next((user for _, user in list_users() if user["user_id"] == user_id), None)


def create_user(user: dict[str, str]) -> None:
    with _user_write_lock:
        for _, existing in list_users():
            if existing["username"].casefold() == user["username"].casefold():
                raise StorageError("USERNAME_TAKEN")
            if user.get("email") and existing["email"].casefold() == user["email"].casefold():
                raise StorageError("EMAIL_TAKEN")
        _append(USERS_TAB, [user.get(column, "") for column in USER_COLUMNS])


def update_user(row_number: int, user: dict[str, str]) -> None:
    with _user_write_lock:
        _update_user(row_number, user)


def save_study_set(study_set: dict[str, Any]) -> None:
    items_json = json.dumps(study_set["items"], ensure_ascii=False, separators=(",", ":"))
    sources_json = json.dumps(study_set.get("sources", []), ensure_ascii=False, separators=(",", ":"))
    if len(items_json) + len(sources_json) > 40_000:
        raise StorageError("This study set is too large to save in a Google Sheets cell.")
    _append(
        SETS_TAB,
        [
            str(study_set["id"]),
            str(study_set["user_id"]),
            str(study_set["title"])[:150],
            str(study_set["type"]),
            items_json,
            sources_json,
            str(study_set["created_at"]),
        ],
    )


def list_study_sets(user_id: str) -> list[dict[str, Any]]:
    result = []
    for _, row in _rows(SETS_TAB, SET_COLUMNS):
        if row["user_id"] != user_id:
            continue
        try:
            items = json.loads(row["items_json"])
            sources = json.loads(row["sources_json"] or "[]")
        except ValueError:
            continue
        result.append({
            "id": row["set_id"],
            "title": row["title"],
            "type": row["type"],
            "items": items,
            "sources": sources,
            "created_at": row["created_at"],
        })
    return sorted(result, key=lambda item: item["created_at"], reverse=True)[:100]


def hash_password(password: str) -> str:
    salt = secrets.token_bytes(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, 310_000)
    return "pbkdf2_sha256$310000$" + salt.hex() + "$" + digest.hex()


def verify_password(password: str, encoded: str) -> bool:
    try:
        algorithm, iterations, salt_hex, digest_hex = encoded.split("$", 3)
        if algorithm != "pbkdf2_sha256":
            return False
        digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), bytes.fromhex(salt_hex), int(iterations))
        return hmac.compare_digest(digest.hex(), digest_hex)
    except (ValueError, TypeError):
        return False


def _b64url(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode("ascii")


def create_session(user_id: str) -> str:
    secret = os.getenv("SESSION_SECRET", "")
    if len(secret) < 32:
        raise StorageError("Sign-in is not configured yet. Add a random SESSION_SECRET of at least 32 characters on Render.")
    payload = _b64url(json.dumps({"sub": user_id, "exp": int(time.time()) + 60 * 60 * 24 * 30}, separators=(",", ":")).encode())
    signature = _b64url(hmac.new(secret.encode(), payload.encode(), hashlib.sha256).digest())
    return payload + "." + signature


def verify_session(token: str) -> str | None:
    secret = os.getenv("SESSION_SECRET", "")
    if len(secret) < 32:
        return None
    try:
        payload, signature = token.split(".", 1)
        expected = _b64url(hmac.new(secret.encode(), payload.encode(), hashlib.sha256).digest())
        if not hmac.compare_digest(signature, expected):
            return None
        encoded = payload + "=" * (-len(payload) % 4)
        contents = json.loads(base64.urlsafe_b64decode(encoded))
        if int(contents.get("exp", 0)) < int(time.time()):
            return None
        return str(contents["sub"])
    except (ValueError, TypeError, KeyError, json.JSONDecodeError):
        return None


def verify_google_credential(credential: str) -> dict[str, str]:
    client_id = os.getenv("GOOGLE_CLIENT_ID", "").strip()
    if not client_id:
        raise StorageError("Google sign-in is not configured yet. Add GOOGLE_CLIENT_ID on Render.")
    try:
        claims = id_token.verify_oauth2_token(credential, GoogleAuthRequest(), client_id)
    except Exception as exc:
        raise StorageError("Google could not verify this sign-in. Please try again.") from exc
    email = str(claims.get("email", "")).strip().lower()
    if not claims.get("email_verified") or not email or not claims.get("sub"):
        raise StorageError("Use a Google account with a verified email address.")
    return {
        "google_sub": str(claims["sub"]),
        "email": email,
        "display_name": str(claims.get("name") or email.split("@", 1)[0])[:100],
    }


def generated_google_username(email: str, existing: set[str]) -> str:
    stem = re.sub(r"[^A-Za-z0-9._-]", "", email.split("@", 1)[0])[:17] or "student"
    candidate = stem
    while candidate.casefold() in existing:
        candidate = f"{stem[:14]}{secrets.randbelow(90_000) + 10_000}"
    return candidate
