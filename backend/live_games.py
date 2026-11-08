"""Server-authoritative, friend-only quiz rooms for the single-worker deployment.

Answers and timing stay on the server. Rooms expire and are not durable across
server restarts; finished standings are saved separately by the API.
"""
import copy
import re
import secrets
import threading
import time
import unicodedata

LOCK = threading.RLock()
ROOMS = {}
QUESTION_SECONDS = 25


def normalize(value):
    return re.sub(r"[^\w]+", " ", unicodedata.normalize("NFKC", str(value)).casefold()).strip()


def card_kind(card, kind):
    if card.get("quiz_type"):
        return card["quiz_type"]
    if kind == "same_as_source":
        if card.get("matching_prompts"):
            return "matching"
        return "multiple_choice" if card.get("options") else "identification"
    return kind


def exact(value):
    return re.sub(r"\s+", " ", unicodedata.normalize("NFKC", str(value))).strip().casefold()


def correct_answer(card, kind, answer):
    kind = card_kind(card, kind)
    if kind == "matching":
        pairs = card.get("matching_pairs") or []
        prompts = card.get("matching_prompts") or []
        return (isinstance(answer, dict) and bool(prompts) and len(pairs) == len(prompts)
                and set(answer) == set(prompts)
                and all(isinstance(answer.get(pair["prompt"]), str)
                        and exact(answer[pair["prompt"]]) == exact(pair["answer"]) for pair in pairs))
    expected = card.get("correct_answer") or card.get("answer", "")
    if card.get("imported"):
        values = answer if isinstance(answer, list) else [answer]
        key = lambda value: re.sub(r"\s+", " ", value).strip().casefold()
        if card.get("correct_answers"):
            correct = card["correct_answers"]
            return (all(isinstance(value, str) for value in values)
                    and len(values) == len(correct)
                    and len(set(map(key, values))) == len(values)
                    and set(map(key, values)) == set(map(key, correct)))
        return len(values) == 1 and isinstance(values[0], str) and key(values[0]) == key(expected)
    # Match whole options before splitting: commas may belong to an option.
    options = card.get("options", [])
    # An exact option may itself contain a pipe or be the letter "A". Resolve
    # its text first so it cannot turn into another option's printed label.
    whole_option = next((option for option in options if exact(option) == exact(expected)), None)
    parts = [whole_option] if whole_option is not None else expected if isinstance(expected, list) else str(expected).split("|")
    resolved = []
    for part in parts:
        option = next((option for option in options if exact(option) == exact(part)), None)
        letter = re.fullmatch(r"(?:option\s*)?([A-Ha-h])[.):\-]?", str(part).strip())
        if option is not None:
            resolved.append(option)
        elif letter and ord(letter[1].upper()) - 65 < len(options):
            resolved.append(options[ord(letter[1].upper()) - 65])
        else:
            resolved.append(str(part))
    key = exact if options else normalize
    expected_values = {key(x) for x in resolved if key(x)}
    if kind == "checkbox":
        if not isinstance(answer, list) or not answer or len(answer) != len(set(map(key, answer))):
            return False
        return {key(x) for x in answer} == expected_values
    return isinstance(answer, str) and key(answer) in expected_values


def create(owner, study_set):
    with LOCK:
        for code in list(ROOMS):
            if time.time() - ROOMS[code]["touched"] > 3600:
                del ROOMS[code]
        code = "".join(secrets.choice("ABCDEFGHJKLMNPQRSTUVWXYZ23456789") for _ in range(6))
        room = {"code": code, "host": owner, "title": study_set["title"], "kind": study_set["type"], "cards": copy.deepcopy(study_set["items"][:30]), "players": {owner: {"points": 0, "correct": 0}}, "phase": "lobby", "index": -1, "deadline": 0, "answers": {}, "invited": set(), "touched": time.time(), "saved": False, "game_id": secrets.token_hex(16)}
        ROOMS[code] = room
        return room


def advance(room, clock=None):
    clock = time.time() if clock is None else clock
    # Advance from the previous deadline, so polling delays cannot lengthen a round.
    while room["phase"] in {"countdown", "question", "reveal"} and clock >= room["deadline"]:
        boundary = room["deadline"]
        if room["phase"] == "question":
            room["phase"] = "reveal"
            room["deadline"] = boundary + 5
        else:
            room["index"] += 1
            room["answers"] = {}
            if room["index"] >= len(room["cards"]):
                room["phase"] = "finished"
            else:
                room["phase"] = "question"
                room["deadline"] = boundary + QUESTION_SECONDS


def submit(room, user, answer, clock=None):
    clock = time.time() if clock is None else clock
    advance(room, clock)
    if room["phase"] != "question" or user in room["answers"]:
        return False
    correct = correct_answer(room["cards"][room["index"]], room["kind"], answer)
    points = 1000 + round(500 * max(0, room["deadline"] - clock) / QUESTION_SECONDS) if correct else 0
    room["answers"][user] = {"answer": answer, "correct": correct, "points": points}
    room["players"][user]["points"] += points
    room["players"][user]["correct"] += int(correct)
    if len(room["answers"]) == len(room["players"]):
        room["phase"] = "reveal"
        room["deadline"] = clock + 5
    return True


def snapshot(room, user, profiles):
    advance(room)
    players = sorted(({"id": uid, **score, **profiles.get(uid, {"nickname": "Study friend", "avatar_id": "cat"})} for uid, score in room["players"].items()), key=lambda x: (-x["points"], -x["correct"], x["id"]))
    last_score = None
    rank = 0
    for index, player in enumerate(players):
        score = (player["points"], player["correct"])
        if score != last_score:
            rank = index + 1
        player["rank"] = rank
        last_score = score
    data = {"code": room["code"], "host": room["host"], "title": room["title"], "kind": room["kind"], "phase": room["phase"], "index": room["index"], "total": len(room["cards"]), "deadline": room["deadline"] * 1000, "server_time": time.time() * 1000, "players": players, "answered": user in room["answers"], "answered_count": len(room["answers"])}
    if room["phase"] in {"question", "reveal"}:
        card = room["cards"][room["index"]]
        data["question"] = {"question": card["question"], "options": card.get("options", []),
                            "quiz_type": card_kind(card, room["kind"]), "images": card.get("images", []),
                            "image_labels": card.get("image_labels", []),
                            "matching_prompts": card.get("matching_prompts", []),
                            "matching_options": card.get("matching_options", [])}
        if room["phase"] == "reveal":
            data["question"].update({"answer": card.get("correct_answer") or card.get("answer"), "explanation": card.get("explanation", "")})
            if card.get("matching_pairs"):
                data["question"]["matching_pairs"] = card["matching_pairs"]
            data["feedback"] = room["answers"].get(user, {"correct": False, "points": 0})
    return data
