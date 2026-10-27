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
from datetime import datetime, timezone
from typing import Any
from urllib.parse import quote

import requests
from google.auth.transport.requests import Request as GoogleAuthRequest
from google.oauth2 import id_token, service_account


SHEETS_SCOPE = "https://www.googleapis.com/auth/spreadsheets"
USERS_TAB = "Users"
SETS_TAB = "StudySets"
USAGE_TAB = "AIUsage"
PROGRESS_TAB = "CardProgress"
REVIEWS_TAB = "ReviewLogs"
SHARES_TAB = "StudyShares"
REPORTS_TAB = "CardReports"
USER_COLUMNS = ["user_id", "username", "email", "password_hash", "google_sub", "display_name", "created_at"]
SET_COLUMNS = ["set_id", "user_id", "title", "type", "items_json", "sources_json", "created_at"]
USAGE_COLUMNS = ["scope_key", "usage_date", "generation_count"]
PROGRESS_COLUMNS = ["user_id", "set_id", "card_id", "due_at", "interval_days", "ease_factor", "repetitions", "lapses", "last_reviewed_at", "last_rating"]
REVIEW_COLUMNS = ["user_id", "set_id", "card_id", "reviewed_at", "rating", "was_correct"]
SHARE_COLUMNS = ["token", "user_id", "set_id", "created_at"]
REPORT_COLUMNS = ["report_id", "user_id", "set_id", "card_id", "reason", "note", "created_at"]
_schema_ready = False
_schema_lock = threading.Lock()
_user_write_lock = threading.Lock()
_usage_write_lock = threading.Lock()
_set_write_lock = threading.Lock()
_review_write_lock = threading.Lock()


class StorageError(RuntimeError):
    pass


class UsageLimitExceeded(RuntimeError):
    def __init__(self, used: int, limit: int):
        super().__init__("The daily study-set generation limit has been reached.")
        self.used = used
        self.limit = limit


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
        missing = [title for title in (USERS_TAB, SETS_TAB, USAGE_TAB, PROGRESS_TAB, REVIEWS_TAB, SHARES_TAB, REPORTS_TAB) if title not in titles]
        if missing:
            _api("POST", ":batchUpdate", body={"requests": [{"addSheet": {"properties": {"title": title}}} for title in missing]})
        for tab, columns in ((USERS_TAB, USER_COLUMNS), (SETS_TAB, SET_COLUMNS), (USAGE_TAB, USAGE_COLUMNS), (PROGRESS_TAB, PROGRESS_COLUMNS), (REVIEWS_TAB, REVIEW_COLUMNS), (SHARES_TAB, SHARE_COLUMNS), (REPORTS_TAB, REPORT_COLUMNS)):
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
    with _set_write_lock:
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


def delete_study_set(user_id: str, set_id: str) -> bool:
    """Delete one saved set only when it belongs to the requesting account."""
    with _set_write_lock:
        row_number = next(
            (
                row_number
                for row_number, row in _rows(SETS_TAB, SET_COLUMNS)
                if row["user_id"] == user_id and row["set_id"] == set_id
            ),
            None,
        )
        if row_number is None:
            return False

        metadata = _api("GET", "")
        sheet_id = next(
            (
                sheet.get("properties", {}).get("sheetId")
                for sheet in metadata.get("sheets", [])
                if sheet.get("properties", {}).get("title") == SETS_TAB
            ),
            None,
        )
        if sheet_id is None:
            raise StorageError("The StudySets tab could not be found in the spreadsheet.")
        _api(
            "POST",
            ":batchUpdate",
            body={
                "requests": [
                    {
                        "deleteDimension": {
                            "range": {
                                "sheetId": sheet_id,
                                "dimension": "ROWS",
                                "startIndex": row_number - 1,
                                "endIndex": row_number,
                            }
                        }
                    }
                ]
            },
        )
        _delete_rows_for_set(PROGRESS_TAB, PROGRESS_COLUMNS, user_id, set_id)
        _delete_rows_for_set(REVIEWS_TAB, REVIEW_COLUMNS, user_id, set_id)
        _delete_rows_for_set(SHARES_TAB, SHARE_COLUMNS, user_id, set_id)
        return True


def _delete_rows_for_set(tab: str, columns: list[str], user_id: str, set_id: str) -> None:
    metadata = _api("GET", "")
    sheet_id = next((sheet.get("properties", {}).get("sheetId") for sheet in metadata.get("sheets", []) if sheet.get("properties", {}).get("title") == tab), None)
    if sheet_id is None:
        return
    matching = [row_number for row_number, row in _rows(tab, columns) if row["user_id"] == user_id and row["set_id"] == set_id]
    if matching:
        _api("POST", ":batchUpdate", body={"requests": [{"deleteDimension": {"range": {"sheetId": sheet_id, "dimension": "ROWS", "startIndex": row_number - 1, "endIndex": row_number}}} for row_number in reversed(matching)]})


def get_or_create_study_share(user_id: str, set_id: str) -> str:
    with _set_write_lock:
        existing = next((row["token"] for _, row in _rows(SHARES_TAB, SHARE_COLUMNS) if row["user_id"] == user_id and row["set_id"] == set_id), None)
        if existing:
            return existing
        token = secrets.token_urlsafe(32)
        _append(SHARES_TAB, [token, user_id, set_id, datetime.now(timezone.utc).isoformat()])
        return token


def revoke_study_share(user_id: str, set_id: str) -> bool:
    with _set_write_lock:
        exists = any(row["user_id"] == user_id and row["set_id"] == set_id for _, row in _rows(SHARES_TAB, SHARE_COLUMNS))
        if exists:
            _delete_rows_for_set(SHARES_TAB, SHARE_COLUMNS, user_id, set_id)
        return exists


def get_shared_study_set(token: str) -> dict[str, Any] | None:
    share = next((row for _, row in _rows(SHARES_TAB, SHARE_COLUMNS) if hmac.compare_digest(row["token"], token)), None)
    if not share:
        return None
    return next((study_set for study_set in list_study_sets(share["user_id"]) if study_set["id"] == share["set_id"]), None)


def save_card_report(report: dict[str, str]) -> None:
    _append(REPORTS_TAB, [report.get(column, "") for column in REPORT_COLUMNS])


def review_data(user_id: str) -> tuple[list[dict[str, str]], list[dict[str, str]]]:
    progress = [row for _, row in _rows(PROGRESS_TAB, PROGRESS_COLUMNS) if row["user_id"] == user_id]
    reviews = [row for _, row in _rows(REVIEWS_TAB, REVIEW_COLUMNS) if row["user_id"] == user_id]
    return progress, reviews


def save_card_review(user_id: str, set_id: str, card_id: str, progress: dict[str, str], review: dict[str, str]) -> None:
    with _review_write_lock:
        existing = next(((number, row) for number, row in _rows(PROGRESS_TAB, PROGRESS_COLUMNS) if row["user_id"] == user_id and row["set_id"] == set_id and row["card_id"] == card_id), None)
        if existing:
            row_number, _ = existing
            range_name = quote(f"{PROGRESS_TAB}!A{row_number}:J{row_number}", safe="!:")
            _api("PUT", f"/values/{range_name}", params={"valueInputOption": "RAW"}, body={"values": [[progress.get(column, "") for column in PROGRESS_COLUMNS]]})
        else:
            _append(PROGRESS_TAB, [progress.get(column, "") for column in PROGRESS_COLUMNS])
        _append(REVIEWS_TAB, [review.get(column, "") for column in REVIEW_COLUMNS])


def reserve_daily_generation(scope_key: str, usage_date: str, limit: int) -> int:
    """Atomically reserve one daily generation within this API process."""
    with _usage_write_lock:
        match = next(
            (
                (row_number, row)
                for row_number, row in _rows(USAGE_TAB, USAGE_COLUMNS)
                if row["scope_key"] == scope_key and row["usage_date"] == usage_date
            ),
            None,
        )
        if match:
            row_number, row = match
            try:
                used = int(row["generation_count"] or "0")
            except ValueError:
                used = 0
            if used >= limit:
                raise UsageLimitExceeded(used, limit)
            _api(
                "PUT",
                f"/values/{quote(f'{USAGE_TAB}!C{row_number}', safe='!:')}",
                params={"valueInputOption": "RAW"},
                body={"values": [[str(used + 1)]]},
            )
            return used + 1

        _append(USAGE_TAB, [scope_key, usage_date, "1"])
        return 1


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
        set_id = row["set_id"]
        items = [
            {**item, "card_id": item.get("card_id") or hashlib.sha256(f"{set_id}:{index}:{item.get('question', '')}".encode()).hexdigest()[:24]}
            for index, item in enumerate(items)
        ]
        result.append({
            "id": set_id,
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
