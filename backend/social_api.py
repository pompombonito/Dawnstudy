import base64
import hashlib
import json
import re
import secrets
import threading
import time
from collections import defaultdict, deque
from typing import Literal
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict, Field
import accounts
import social_store as store
import live_games as games

PRESENCE = {}
LIMITS = defaultdict(deque)
RATE_LOCK = threading.Lock()
ANIMALS = {"cat", "fox", "bunny", "bear", "dog", "owl", "panda", "capybara", "penguin", "duck", "pompompurin", "cinnamoroll", "kuromi", "hello-kitty", "my-melody", "keroppi", "pochacco", "tuxedosam", "badtz-maru"}


def limited(user, action, count=20, seconds=60):
    with RATE_LOCK:
        key = (user, action)
        queue = LIMITS[key]
        now = time.monotonic()
        while queue and now - queue[0] > seconds:
            queue.popleft()
        if len(queue) >= count:
            raise HTTPException(429, "Please slow down and try again in a moment.")
        queue.append(now)
        if len(LIMITS) > 10000:
            for old in list(LIMITS):
                if not LIMITS[old] or now - LIMITS[old][-1] > 3600:
                    del LIMITS[old]


class ProfileInput(BaseModel):
    nickname: str = Field(min_length=2, max_length=24)
    avatar_id: str = Field(max_length=80)
    gender: Literal["male", "female", "gender-diverse", "prefer-not-to-say"]
    theme: Literal["light", "dark", "rose"]
    discoverable: bool = False
    companion_id: str = "cat"
    companion_name: str = Field(default="Miso", min_length=1, max_length=24)
    accept_terms: bool = False
    terms_version: str = ""


class FriendAction(BaseModel):
    user_id: str = Field(min_length=1, max_length=100)
    action: Literal["request", "accept", "decline", "cancel", "unfriend", "block", "unblock"]


class KeyInput(BaseModel):
    public_key: dict


class Envelope(BaseModel):
    model_config = ConfigDict(extra="forbid")
    version: Literal[1]
    salt: str = Field(max_length=60)
    iv: str = Field(max_length=30)
    ciphertext: str = Field(max_length=12000)
    sender_key: str = Field(pattern=r"^[a-f0-9]{64}$")
    recipient_key: str = Field(pattern=r"^[a-f0-9]{64}$")


class MessageInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    recipient_id: str = Field(max_length=100)
    client_id: str = Field(pattern=r"^[a-zA-Z0-9-]{16,80}$")
    envelope: Envelope


class CompanionInput(BaseModel):
    message: str = Field(min_length=1, max_length=1200)
    history: list[dict[str, str]] = Field(default_factory=list, max_length=12)


class GameInput(BaseModel):
    set_id: str = Field(max_length=100)


class GameAction(BaseModel):
    action: Literal["join", "start", "answer", "invite", "leave"]
    answer: str | list[str] = ""
    user_id: str = ""
    question_index: int = -1


def create_router(authenticated_user, reply):
    router = APIRouter(prefix="/api/community")

    def signed(user=Depends(authenticated_user)):
        try:
            if not store.ready(user["user_id"]):
                raise HTTPException(403, "Complete your profile and read the user agreement first.")
        except accounts.StorageError as exc:
            raise HTTPException(503, str(exc)) from exc
        return user["user_id"]

    def online(uid):
        return time.time() - PRESENCE.get(uid, 0) < 100

    def friend_profiles(uid):
        profiles = {p["user_id"]: p for _, p in store.rows("Profiles")}
        friends, incoming, outgoing = [], [], []
        for _, row in store.rows("Friendships"):
            if uid not in {row["sender_id"], row["recipient_id"]}:
                continue
            other = row["recipient_id"] if row["sender_id"] == uid else row["sender_id"]
            if other not in profiles or store.is_blocked(uid, other):
                continue
            person = store.public_profile(profiles[other], online(other) if row["status"] == "accepted" else False)
            if row["status"] == "accepted":
                friends.append(person)
            elif row["status"] == "pending":
                (outgoing if row["sender_id"] == uid else incoming).append(person)
        return friends, incoming, outgoing

    @router.get("/bootstrap")
    def bootstrap(user=Depends(authenticated_user)):
        uid = user["user_id"]
        value = store.profile(uid)
        if not value or not store.ready(uid):
            return {"profile": store.own_profile(value), "friends": [], "incoming": [], "outgoing": [], "invitations": [], "blocked": [], "terms_version": store.TERMS_VERSION}
        friends, incoming, outgoing = friend_profiles(uid)
        invitations = []
        with games.LOCK:
            for room in games.ROOMS.values():
                if uid in room["invited"] and room["phase"] == "lobby" and time.time() - room["touched"] < 3600 and store.are_friends(uid, room["host"]):
                    invitations.append({"code": room["code"], "title": room["title"]})
        profiles = {p["user_id"]: p for _, p in store.rows("Profiles")}
        blocked = [store.public_profile(profiles[r["blocked_id"]]) for _, r in store.rows("UserBlocks") if r["user_id"] == uid and r["active"] == "true" and r["blocked_id"] in profiles]
        return {"profile": store.own_profile(value), "friends": friends, "incoming": incoming, "outgoing": outgoing, "invitations": invitations, "blocked": blocked, "terms_version": store.TERMS_VERSION}

    @router.put("/profile")
    def update_profile(body: ProfileInput, user=Depends(authenticated_user)):
        uid = user["user_id"]
        limited(uid, "profile", 10)
        nickname = body.nickname.strip()
        name = body.companion_name.strip()
        if len(nickname) < 2 or not name or any(ord(c) < 32 for c in nickname + name):
            raise HTTPException(422, "Use a nickname of 2–24 characters and a companion name without control characters.")
        if body.avatar_id not in ANIMALS and not re.fullmatch(r"portrait-(?:male|female)-(?:daily|clinical|lab|scrubs|sport|formal)-[0-7]", body.avatar_id):
            raise HTTPException(422, "Choose an available profile icon.")
        if body.companion_id not in ANIMALS:
            raise HTTPException(422, "Choose an available companion.")
        changes = body.model_dump(exclude={"accept_terms", "terms_version"})
        changes.update(nickname=nickname, companion_name=name, discoverable=str(body.discoverable).lower())
        if not store.ready(uid):
            if not body.accept_terms or body.terms_version != store.TERMS_VERSION:
                raise HTTPException(422, "Read and accept the current user agreement to finish setup.")
            changes.update(onboarding_version=store.TERMS_VERSION, terms_version=store.TERMS_VERSION, terms_accepted_at=store.now())
        return store.own_profile(store.save_profile(uid, changes))

    @router.post("/presence")
    def presence(uid=Depends(signed)):
        PRESENCE[uid] = time.time()
        for old in list(PRESENCE):
            if time.time() - PRESENCE[old] > 120:
                PRESENCE.pop(old, None)
        return {"ok": True}

    @router.delete("/presence")
    def offline(uid=Depends(signed)):
        PRESENCE.pop(uid, None)
        return {"ok": True}

    @router.get("/directory")
    def directory(q: str = "", offset: int = 0, uid=Depends(signed)):
        needle = q.strip().lstrip("#").casefold()[:80]
        candidates = []
        for _, person in store.rows("Profiles"):
            other = person["user_id"]
            if other == uid or person["discoverable"] != "true" or person["onboarding_version"] != store.TERMS_VERSION or store.is_blocked(uid, other):
                continue
            if needle and needle not in person["nickname"].casefold() and needle != other[-6:].casefold():
                continue
            pair = store.relationship(uid, other)
            candidates.append({**store.public_profile(person), "relationship": pair[1]["status"] if pair else "none", "outgoing": bool(pair and pair[1]["sender_id"] == uid)})
        offset = max(0, min(10000, offset))
        return {"people": candidates[offset:offset + 24], "more": len(candidates) > offset + 24}

    @router.post("/friends")
    def friends_action(body: FriendAction, uid=Depends(signed)):
        limited(uid, "friend", 15)
        other = body.user_id
        if other == uid or not store.profile(other):
            raise HTTPException(404, "That profile is unavailable.")
        with store.LOCK:
            pair = store.relationship(uid, other)
            if body.action in {"block", "unblock"}:
                current = next(((n, r) for n, r in store.rows("UserBlocks") if r["user_id"] == uid and r["blocked_id"] == other), None)
                store.write("UserBlocks", {"block_id": current[1]["block_id"] if current else secrets.token_hex(16), "user_id": uid, "blocked_id": other, "active": str(body.action == "block").lower(), "created_at": store.now()}, current[0] if current else None)
                if body.action == "block" and pair:
                    store.write("Friendships", {**pair[1], "status": "removed", "updated_at": store.now()}, pair[0])
                return {"ok": True}
            if store.is_blocked(uid, other):
                raise HTTPException(403, "This connection is unavailable.")
            status = pair[1]["status"] if pair else "none"
            if body.action == "request":
                if status in {"pending", "accepted"}:
                    raise HTTPException(409, "A request or friendship already exists.")
                if store.profile(other)["discoverable"] != "true":
                    raise HTTPException(403, "This person is not accepting discovery requests.")
                value = {"relationship_id": secrets.token_hex(16), "sender_id": uid, "recipient_id": other, "status": "pending", "created_at": store.now(), "updated_at": store.now()}
            else:
                if not pair:
                    raise HTTPException(404, "Connection not found.")
                if body.action in {"accept", "decline"} and (status != "pending" or pair[1]["recipient_id"] != uid):
                    raise HTTPException(403, "Only the recipient can respond to this request.")
                if body.action == "cancel" and (status != "pending" or pair[1]["sender_id"] != uid):
                    raise HTTPException(403, "You can only cancel your own pending request.")
                value = {**pair[1], "status": "accepted" if body.action == "accept" else "removed", "updated_at": store.now()}
            store.write("Friendships", value, pair[0] if pair else None)
        return {"ok": True}

    @router.put("/messaging-key")
    def publish_key(body: KeyInput, uid=Depends(signed)):
        limited(uid, "key", 5)
        key = body.public_key
        if set(key) - {"kty", "crv", "x", "y", "ext", "key_ops"} or key.get("kty") != "EC" or key.get("crv") != "P-256":
            raise HTTPException(422, "A public P-256 key is required. Never upload a private key.")
        try:
            if any(len(base64.urlsafe_b64decode(key.get(part, "") + "==")) != 32 for part in ("x", "y")):
                raise ValueError()
        except (ValueError, TypeError):
            raise HTTPException(422, "Invalid public key.")
        public = {k: key[k] for k in ("kty", "crv", "x", "y")}
        fingerprint = hashlib.sha256(f"{public['x']}.{public['y']}".encode()).hexdigest()
        with store.LOCK:
            current = store.profile(uid)
            if current.get("key_fingerprint") and current["key_fingerprint"] != fingerprint:
                raise HTTPException(409, "This account already has a messaging key. Restore your encrypted recovery file on this device.")
            from cryptography.hazmat.primitives.asymmetric import ec
            try:
                coordinates = [int.from_bytes(base64.urlsafe_b64decode(public[p] + "=="), "big") for p in ("x", "y")]
                ec.EllipticCurvePublicNumbers(*coordinates, ec.SECP256R1()).public_key()
            except ValueError:
                raise HTTPException(422, "The public key is not a valid P-256 point.")
            store.save_profile(uid, {"public_key_json": json.dumps(public), "key_fingerprint": fingerprint})
        return {"public_key": public, "fingerprint": fingerprint}

    @router.get("/messaging-key/{other}")
    def messaging_key(other: str, uid=Depends(signed)):
        if other != uid and not store.are_friends(uid, other):
            raise HTTPException(403, "Private messaging is available between accepted friends.")
        value = store.profile(other)
        return {"public_key": json.loads(value["public_key_json"]) if value and value.get("public_key_json") else None, "fingerprint": value.get("key_fingerprint", "") if value else ""}

    @router.post("/messages")
    def send_message(body: MessageInput, uid=Depends(signed)):
        limited(uid, "message", 20)
        if not store.are_friends(uid, body.recipient_id):
            raise HTTPException(403, "Private messaging is available between accepted friends.")
        envelope = body.envelope.model_dump()
        for field, length in (("salt", 32), ("iv", 12), ("ciphertext", None)):
            try:
                raw = base64.b64decode(envelope[field], validate=True)
                if (length and len(raw) != length) or (not length and not 17 <= len(raw) <= 8016):
                    raise ValueError()
            except (ValueError, TypeError):
                raise HTTPException(422, "Invalid encrypted message envelope.")
        if store.profile(uid).get("key_fingerprint") != envelope["sender_key"] or store.profile(body.recipient_id).get("key_fingerprint") != envelope["recipient_key"]:
            raise HTTPException(409, "A messaging key changed. Verify your friend's safety code before sending.")
        with store.LOCK:
            duplicate = next((r for _, r in store.rows("EncryptedMessages") if r["sender_id"] == uid and r["client_id"] == body.client_id), None)
            if duplicate:
                return {"id": duplicate["message_id"]}
            value = {"message_id": secrets.token_hex(16), "sender_id": uid, "recipient_id": body.recipient_id, "envelope_json": json.dumps(envelope, separators=(",", ":")), "created_at": store.now(), "client_id": body.client_id}
            store.write("EncryptedMessages", value)
        return {"id": value["message_id"]}

    @router.get("/messages/{other}")
    def messages(other: str, before: str = "", uid=Depends(signed)):
        if not store.are_friends(uid, other):
            raise HTTPException(403, "Private messaging is available between accepted friends.")
        records = [r for _, r in store.rows("EncryptedMessages") if {r["sender_id"], r["recipient_id"]} == {uid, other} and (not before or r["created_at"] < before)]
        return {"messages": [{"id": r["message_id"], "sender_id": r["sender_id"], "recipient_id": r["recipient_id"], "created_at": r["created_at"], "envelope": json.loads(r["envelope_json"])} for r in records[-50:]], "more": len(records) > 50}

    @router.post("/companion")
    def companion(body: CompanionInput, uid=Depends(signed)):
        limited(uid, "companion", 10)
        history = [{"role": r["role"], "content": r.get("content", "")[:1200]} for r in body.history if r.get("role") in {"user", "assistant"}][-12:]
        text, model = reply(body.message, history, store.profile(uid)["companion_name"])
        suggest = bool(re.search(r"lonel|alone|no friends|isolat|sad|malungkot|mag.isa|walang kaibigan", body.message, re.I))
        return {"reply": text, "model": model, "suggest_friends": suggest}

    def room_for(code, uid, member=True):
        room = games.ROOMS.get(code.upper())
        if not room or time.time() - room["touched"] > 3600:
            raise HTTPException(404, "This room expired or the server restarted. Create a new game.")
        if member and uid not in room["players"]:
            raise HTTPException(403, "Join this room first.")
        room["touched"] = time.time()
        return room

    def room_snapshot(room, uid):
        profiles = {p["user_id"]: {"nickname": p["nickname"], "avatar_id": p["avatar_id"]} for _, p in store.rows("Profiles")}
        result = games.snapshot(room, uid, profiles)
        if room["phase"] == "finished" and not room["saved"]:
            # One RAW append for the entire podium, not a write per polling player.
            columns = accounts.SOCIAL_TABLES["GameResults"]
            data = [{"game_id": room["game_id"], "user_id": p["id"], "set_title": room["title"], "points": p["points"], "correct": p["correct"], "total": len(room["cards"]), "rank": p["rank"], "finished_at": store.now()} for p in result["players"]]
            accounts._api("POST", "/values/GameResults!A1:append", params={"valueInputOption": "RAW", "insertDataOption": "INSERT_ROWS"}, body={"values": [[str(r[c]) for c in columns] for r in data]})
            room["saved"] = True
        return result

    @router.post("/games")
    def create_game(body: GameInput, uid=Depends(signed)):
        limited(uid, "game", 5)
        study_set = next((s for s in accounts.list_study_sets(uid) if s["id"] == body.set_id), None)
        if not study_set or study_set["type"] == "flashcards" or not study_set["items"]:
            raise HTTPException(422, "Choose a saved multiple-choice, identification, or select-all quiz.")
        with games.LOCK:
            active = next((r for r in games.ROOMS.values() if uid == r["host"] and r["phase"] != "finished" and time.time() - r["touched"] < 3600), None)
            if active:
                return room_snapshot(active, uid)
            return room_snapshot(games.create(uid, study_set), uid)

    @router.get("/games/{code}")
    def game_status(code: str, uid=Depends(signed)):
        with games.LOCK:
            return room_snapshot(room_for(code, uid), uid)

    @router.post("/games/{code}")
    def game_action(code: str, body: GameAction, uid=Depends(signed)):
        limited(uid, "game_action", 60)
        with games.LOCK:
            room = room_for(code, uid, member=body.action != "join")
            games.advance(room)
            if body.action == "join" and uid not in room["players"]:
                if room["phase"] != "lobby" or len(room["players"]) >= 12 or not store.are_friends(uid, room["host"]):
                    raise HTTPException(403, "Join a friend's lobby before the game starts (up to 12 players).")
                if any(store.is_blocked(uid, p) for p in room["players"]):
                    raise HTTPException(403, "This connection is unavailable.")
                room["players"][uid] = {"points": 0, "correct": 0}
            elif body.action == "start":
                if uid != room["host"] or room["phase"] != "lobby" or len(room["players"]) < 2:
                    raise HTTPException(409, "The host can start once at least two friends are in the lobby.")
                room["phase"], room["deadline"] = "countdown", time.time() + 4
            elif body.action == "answer":
                if body.question_index != room["index"] or len(json.dumps(body.answer)) > 4000 or not games.submit(room, uid, body.answer):
                    raise HTTPException(409, "That round ended or your answer was already submitted.")
            elif body.action == "invite":
                if uid != room["host"] or room["phase"] != "lobby" or not store.are_friends(uid, body.user_id):
                    raise HTTPException(403, "The host can invite accepted friends to the lobby.")
                room["invited"].add(body.user_id)
            elif body.action == "leave":
                room["players"].pop(uid, None)
                if not room["players"]:
                    del games.ROOMS[room["code"]]
                elif uid == room["host"]:
                    room["host"] = next(iter(room["players"]))
                return {"left": True}
            return room_snapshot(room, uid)

    return router
