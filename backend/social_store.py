"""Social records. Message contents arrive as browser-encrypted envelopes only."""
import json
import threading
from datetime import datetime, timezone
from urllib.parse import quote
import accounts

TERMS_VERSION = "2026-10-30"
LOCK = threading.RLock()


def now():
    return datetime.now(timezone.utc).isoformat()


def rows(tab):
    return accounts._rows(tab, accounts.SOCIAL_TABLES[tab])


def write(tab, value, number=None):
    columns = accounts.SOCIAL_TABLES[tab]
    values = [str(value.get(key, "")) for key in columns]
    if number is None:
        accounts._append(tab, values)
    else:
        target = quote(f"{tab}!A{number}:{chr(64 + len(columns))}{number}", safe="!:")
        accounts._api("PUT", f"/values/{target}", params={"valueInputOption": "RAW"}, body={"values": [values]})
        accounts._invalidate_rows(tab)
    return value


def profile(user_id):
    return next((row for _, row in rows("Profiles") if row["user_id"] == user_id), None)


def ready(user_id):
    value = profile(user_id)
    return bool(value and value["onboarding_version"] == TERMS_VERSION and value["terms_version"] == TERMS_VERSION)


def save_profile(user_id, changes):
    with LOCK:
        existing = next(((n, r) for n, r in rows("Profiles") if r["user_id"] == user_id), None)
        value = dict(existing[1]) if existing else {"user_id": user_id, "created_at": now(), "companion_id": "cat", "companion_name": "Miso", "discoverable": "false"}
        value.update(changes)
        value["updated_at"] = now()
        return write("Profiles", value, existing[0] if existing else None)


def is_blocked(a, b):
    return any(r["active"] == "true" and {r["user_id"], r["blocked_id"]} == {a, b} for _, r in rows("UserBlocks"))


def relationship(a, b):
    return next(((n, r) for n, r in rows("Friendships") if {r["sender_id"], r["recipient_id"]} == {a, b}), None)


def are_friends(a, b):
    pair = relationship(a, b)
    return bool(pair and pair[1]["status"] == "accepted" and not is_blocked(a, b))


def public_profile(value, online=False):
    return {"id": value["user_id"], "nickname": value["nickname"], "avatar_id": value["avatar_id"], "tag": value["user_id"][-6:], "online": online}


def own_profile(value):
    if not value:
        return None
    result = {key: value.get(key, "") for key in accounts.SOCIAL_TABLES["Profiles"] if key != "public_key_json"}
    result["discoverable"] = result["discoverable"] == "true"
    result["onboarded"] = ready(value["user_id"])
    result["public_key"] = json.loads(value["public_key_json"]) if value.get("public_key_json") else None
    return result
