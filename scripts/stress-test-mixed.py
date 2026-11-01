"""Isolated Dawnstudy mixed-load simulation; never targets a live URL.

Run with an existing backend Python environment plus httpx. For the bundled
runtime (which already has pypdf/python-docx/python-pptx/Pillow/cryptography),
install only these missing light dependencies:
  python -m pip install --target <temp-deps> fastapi==0.115.6 requests==2.32.3 python-multipart==0.0.20 google-auth httpx
  $env:LOAD_TEST_PYTHON_DEPS = '<temp-deps>'  # optional in PowerShell
  python scripts/stress-test-mixed.py --output docs/mixed-load-test-2026-11-01.json
  python scripts/stress-test-mixed.py --capacity-25 --output docs/mixed-load-25-students.json

Real ASGI routes, authentication lookups/profile readiness, Sheets row caches,
serialization, review scheduling, provider fallback/batching, generation jobs,
and the production Sheets retry loop run in this process. Google login is replaced
with synthetic identities. Sheets HTTP is replaced with thread-safe memory;
model HTTP is replaced with deterministic answers/latency. OCR is stubbed and
not exercised. No production credentials, accounts, storage, or provider calls.
Measured latency is local simulation latency, never a production capacity claim.
"""

import argparse
from copy import deepcopy
from collections import Counter, defaultdict, deque
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
import ipaddress
import json
import math
import os
from pathlib import Path
import re
import socket
import sys
import threading
import time
from types import ModuleType, SimpleNamespace
from contextlib import nullcontext
from urllib.parse import unquote

ROOT = Path(__file__).resolve().parents[1]
if os.environ.get("LOAD_TEST_PYTHON_DEPS"):
    sys.path.insert(0, os.environ["LOAD_TEST_PYTHON_DEPS"])
sys.path.insert(0, str(ROOT / "backend"))
for module_name in ("tesserocr", "tessdata"):
    sys.modules[module_name] = ModuleType(module_name)
for key in ("GEMINI_API_KEY", "MISTRAL_API_KEY", "OPENROUTER_API_KEY", "TAVILY_API_KEY", "GOOGLE_SERVICE_ACCOUNT_JSON", "GOOGLE_CLIENT_ID"):
    os.environ.pop(key, None)
os.environ.update(GROQ_API_KEY="synthetic-never-sent", GOOGLE_SHEETS_SPREADSHEET_ID="synthetic-memory-only", SESSION_SECRET="synthetic-local-secret-which-is-never-persisted")

import requests
import httpx
from fastapi.testclient import TestClient
import accounts
import main as api
import social_store
from generation_jobs import GenerationJobs


def deny_network(*_args, **_kwargs):
    raise RuntimeError("External network is disabled by this isolated load test")


# TestClient's event loop may create local socket pairs on Windows. Only loopback
# connects are permitted; no host can be supplied by the workload or CLI.
original_connect = socket.socket.connect
def guarded_connect(sock, address):
    if isinstance(address, tuple):
        try:
            if ipaddress.ip_address(address[0]).is_loopback:
                return original_connect(sock, address)
        except ValueError:
            pass
    raise RuntimeError("Non-loopback sockets are disabled by this load test")
socket.socket.connect = guarded_connect
socket.create_connection = deny_network
requests.sessions.Session.request = deny_network
httpx.HTTPTransport.handle_request = deny_network
httpx.AsyncHTTPTransport.handle_async_request = deny_network
accounts._credentials = lambda: SimpleNamespace(valid=True, token="synthetic-memory-token")


def percentile(values, fraction):
    if not values:
        return None
    ordered = sorted(values)
    return round(ordered[max(0, math.ceil(len(ordered) * fraction) - 1)], 3)


class MemorySheets:
    def __init__(self, latency, quota):
        self.latency, self.quota = latency, quota
        self.lock = threading.RLock()
        self.tables = {}
        self.grid_properties = {}
        self.events = []
        self.windows = {"read": deque(), "write": deque()}
        self.demand_windows = {"read": deque(), "write": deque()}
        self.enforce = False
        self.started = time.monotonic()

    @staticmethod
    def column_index(label):
        value = 0
        for character in label:
            value = value * 26 + ord(character.upper()) - ord("A") + 1
        return value - 1

    @staticmethod
    def column_label(index):
        label = ""
        index += 1
        while index:
            index, remainder = divmod(index - 1, 26)
            label = chr(ord("A") + remainder) + label
        return label

    def grid(self, tab):
        return self.grid_properties.setdefault(tab, {"rowCount": max(1000, len(self.tables.get(tab, []))), "columnCount": 26})

    def range_bounds(self, a1):
        """Return zero-based half-open bounds for row, column and cell A1 ranges."""
        a1 = unquote(a1)
        if "!" not in a1:
            return a1.strip("'"), 0, None, 0, None
        tab, address = a1.rsplit("!", 1)
        if tab.startswith("'") and tab.endswith("'"):
            tab = tab[1:-1].replace("''", "'")
        parts = address.replace("$", "").split(":")
        if len(parts) > 2:
            raise ValueError(f"Invalid synthetic Sheets range: {a1}")
        def cell(value):
            matched = re.fullmatch(r"([A-Za-z]*)(\d*)", value)
            if not matched or not any(matched.groups()):
                raise ValueError(f"Invalid synthetic Sheets cell: {value}")
            columns, rows = matched.groups()
            return (int(rows) - 1 if rows else None, self.column_index(columns) if columns else None)
        first_row, first_col = cell(parts[0])
        last_row, last_col = cell(parts[-1])
        return tab, first_row or 0, last_row + 1 if last_row is not None else None, first_col or 0, last_col + 1 if last_col is not None else None

    def read_range(self, a1):
        tab, first_row, last_row, first_col, last_col = self.range_bounds(a1)
        table = self.tables[tab]
        values = [list(row[first_col:last_col]) for row in table[first_row:last_row]]
        # Google omits trailing empty cells/rows, while preserving interior gaps.
        for row in values:
            while row and row[-1] in ("", None):
                row.pop()
        while values and not values[-1]:
            values.pop()
        return {"range": a1, "majorDimension": "ROWS", "values": values}

    def write_range(self, a1, values, major_dimension="ROWS"):
        tab, first_row, _last_row, first_col, _last_col = self.range_bounds(a1)
        if major_dimension == "COLUMNS":
            width = max((len(column) for column in values), default=0)
            values = [[column[index] if index < len(column) else None for column in values] for index in range(width)]
        table = self.tables[tab]
        grid = self.grid(tab)
        if first_row + len(values) > grid["rowCount"] or first_col + max((len(row) for row in values), default=0) > grid["columnCount"]:
            raise ValueError(f"Synthetic write exceeds grid limits for {tab}")
        updated_cells = 0
        for row_offset, incoming in enumerate(values):
            row_number = first_row + row_offset
            while len(table) <= row_number:
                table.append([])
            row = table[row_number]
            for col_offset, value in enumerate(incoming):
                if value is None:  # Sheets null inputs skip a cell rather than clear it.
                    continue
                col_number = first_col + col_offset
                while len(row) <= col_number:
                    row.append("")
                row[col_number] = value
                updated_cells += 1
        return {"updatedRange": a1, "updatedRows": len(values), "updatedCells": updated_cells}

    def metadata(self):
        return {"sheets": [{"properties": {"title": title, "sheetId": index, "gridProperties": dict(self.grid(title))}} for index, title in enumerate(self.tables)]}

    def metadata_update(self, requests_body):
        replies = []
        for operation in requests_body:
            if "addSheet" in operation:
                properties = operation["addSheet"]["properties"]
                title = properties["title"]
                if title in self.tables:
                    raise ValueError(f"Duplicate synthetic sheet: {title}")
                self.tables[title] = []
                self.grid_properties[title] = {"rowCount": 1000, "columnCount": 26, **properties.get("gridProperties", {})}
                replies.append({"addSheet": {"properties": {"title": title, "sheetId": len(self.tables) - 1}}})
                continue
            name = next(iter(operation))
            details = operation[name]
            if name == "updateSheetProperties":
                properties = details["properties"]
                title = list(self.tables)[properties["sheetId"]]
                self.grid(title).update(properties.get("gridProperties", {}))
                replies.append({})
                continue
            target = details.get("range", details.get("start", details))
            sheet_id = target.get("sheetId")
            title = list(self.tables)[sheet_id] if sheet_id is not None else None
            if name == "deleteDimension":
                if target["dimension"] != "ROWS":
                    raise ValueError("Only ROWS dimension deletion is used by this harness")
                del self.tables[title][target.get("startIndex", 0):target.get("endIndex")]
            elif name in {"appendCells", "updateCells"}:
                rows = [[cell.get("userEnteredValue", {}).get("stringValue", cell.get("userEnteredValue", {}).get("numberValue", cell.get("userEnteredValue", {}).get("boolValue", ""))) for cell in row.get("values", [])] for row in details.get("rows", [])]
                if name == "appendCells":
                    self.tables[title].extend(rows)
                else:
                    row_index = target.get("rowIndex", target.get("startRowIndex", 0))
                    col_index = target.get("columnIndex", target.get("startColumnIndex", 0))
                    for offset, row in enumerate(rows):
                        while len(self.tables[title]) <= row_index + offset:
                            self.tables[title].append([])
                        existing = self.tables[title][row_index + offset]
                        while len(existing) < col_index + len(row):
                            existing.append("")
                        existing[col_index:col_index + len(row)] = row
            elif name == "appendDimension" and details["dimension"] == "ROWS":
                self.grid(title)["rowCount"] += details["length"]
            else:
                raise ValueError(f"Unsupported synthetic Sheets metadata operation: {name}")
            replies.append({})
        return {"replies": replies}

    def atomic(self, operation):
        before = deepcopy(self.tables)
        grids_before = deepcopy(self.grid_properties)
        try:
            return operation()
        except Exception:
            self.tables = before
            self.grid_properties = grids_before
            raise

    def reset(self, enforce=False):
        with self.lock:
            self.events = []
            self.windows = {"read": deque(), "write": deque()}
            self.demand_windows = {"read": deque(), "write": deque()}
            self.enforce = enforce
            self.started = time.monotonic()

    def transport(self, method, url, *, json=None, params=None, **_kwargs):
        prefix = "https://sheets.googleapis.com/v4/spreadsheets/synthetic-memory-only"
        if not url.startswith(prefix):
            return deny_network()
        time.sleep(self.latency)
        path = unquote(url[len(prefix):])
        kind = "read" if method == "GET" else "write"
        params = params or {}
        if path == "/values:batchGet":
            ranges = params.get("ranges", []) if isinstance(params, dict) else [value for key, value in params if key == "ranges"]
            ranges = [ranges] if isinstance(ranges, str) else list(ranges)
            operation = "values.batchGet"
        elif path == "/values:batchUpdate":
            ranges = [entry["range"] for entry in json.get("data", [])]
            operation = "values.batchUpdate"
        elif path.startswith("/values/"):
            ranges = [path[len("/values/"):].removesuffix(":append").removesuffix(":clear")]
            operation = "values.append" if path.endswith(":append") else f"values.{method.lower()}"
        else:
            ranges, operation = [], "spreadsheets.batchUpdate" if path == ":batchUpdate" else "spreadsheets.get"
        tabs = list(dict.fromkeys(self.range_bounds(a1)[0] for a1 in ranges))
        tab = tabs[0] if len(tabs) == 1 else f"batch[{','.join(tabs)}]" if tabs else "metadata"
        with self.lock:
            now = time.monotonic()
            for window in (self.windows[kind], self.demand_windows[kind]):
                while window and now - window[0] >= 60:
                    window.popleft()
            demanded = len(self.demand_windows[kind]) >= self.quota
            rejected = self.enforce and len(self.windows[kind]) >= self.quota
            self.demand_windows[kind].append(now)
            self.events.append({"seconds": round(now - self.started, 4), "kind": kind, "tab": tab, "operation": operation, "range_count": len(ranges), "status": 429 if rejected else 200, "demand_over_rolling_limit": demanded})
            if rejected:
                return self.response(429, {"error": {"code": 429, "message": "Simulated per-service-account quota"}})
            self.windows[kind].append(now)
            if path == "":
                data = self.metadata()
            elif path == ":batchUpdate" and method == "POST":
                data = self.atomic(lambda: self.metadata_update(json.get("requests", [])))
            elif path == "/values:batchGet" and method == "GET":
                data = {"valueRanges": [self.read_range(a1) for a1 in ranges]}
            elif path == "/values:batchUpdate" and method == "POST":
                results = self.atomic(lambda: [self.write_range(entry["range"], entry.get("values", []), entry.get("majorDimension", "ROWS")) for entry in json.get("data", [])])
                data = {"responses": results, "totalUpdatedRows": sum(result["updatedRows"] for result in results), "totalUpdatedCells": sum(result["updatedCells"] for result in results)}
            elif path.startswith("/values/"):
                table = self.tables[tabs[0]]
                if method == "GET":
                    data = self.read_range(ranges[0])
                elif method == "POST" and path.endswith(":append"):
                    start = max((index + 1 for index, row in enumerate(table) if any(value not in ("", None) for value in row)), default=0)
                    values = [list(row) for row in json["values"]]
                    self.grid(tabs[0])["rowCount"] = max(self.grid(tabs[0])["rowCount"], start + len(values))
                    result = self.write_range(f"{tabs[0]}!A{start + 1}", values)
                    width = max((len(row) for row in values), default=1)
                    result["updatedRange"] = f"{tabs[0]}!A{start + 1}:{self.column_label(width - 1)}{start + len(values)}"
                    data = {"updates": result}
                elif method == "PUT":
                    data = self.write_range(ranges[0], json["values"], json.get("majorDimension", "ROWS"))
                else:
                    raise AssertionError(f"Unexpected memory Sheets operation: {method} {path}")
            else:
                raise AssertionError(f"Unexpected memory Sheets path: {path}")
            return self.response(200, data)

    @staticmethod
    def response(status, data):
        response = requests.Response()
        response.status_code = status
        response._content = __import__("json").dumps(data).encode()
        response.headers["Content-Type"] = "application/json"
        return response

    def report(self):
        groups = {}
        for phase, include in (("startup_0_to_10s", lambda e: e["seconds"] < 10), ("steady_after_10s", lambda e: e["seconds"] >= 10)):
            chosen = [e for e in self.events if include(e)]
            groups[phase] = dict(Counter(e["kind"] for e in chosen))
        peaks = {}
        for kind in ("read", "write"):
            window = deque()
            peak = 0
            for event in self.events:
                if event["kind"] != kind or event["status"] != 200:
                    continue
                while window and event["seconds"] - window[0] >= 60:
                    window.popleft()
                window.append(event["seconds"])
                peak = max(peak, len(window))
            peaks[kind] = peak
        minutes = {}
        for minute in range(int(max((event["seconds"] for event in self.events), default=0) // 60) + 1):
            chosen = [event for event in self.events if minute * 60 <= event["seconds"] < (minute + 1) * 60]
            minutes[f"{minute * 60}_to_{(minute + 1) * 60}s"] = {
                "accepted": dict(Counter(event["kind"] for event in chosen if event["status"] == 200)),
                "http_429": dict(Counter(event["kind"] for event in chosen if event["status"] == 429)),
            }
        return {
            "attempts": dict(Counter(e["kind"] for e in self.events)),
            "accepted": dict(Counter(e["kind"] for e in self.events if e["status"] == 200)),
            "http_429_attempts": dict(Counter(e["kind"] for e in self.events if e["status"] == 429)),
            "attempts_above_rolling_60s_demand_limit": dict(Counter(e["kind"] for e in self.events if e["demand_over_rolling_limit"])),
            "by_table_and_direction": dict(Counter(f"{e['tab']}:{e['kind']}" for e in self.events)),
            "by_operation": dict(Counter(e["operation"] for e in self.events)),
            "peak_accepted_requests_in_rolling_60s": peaks,
            "minute_windows": minutes,
            "phases": groups,
            "first_over_limit_at_seconds": next((e["seconds"] for e in self.events if e["demand_over_rolling_limit"]), None),
        }


class Measurements:
    def __init__(self):
        self.lock = threading.Lock()
        self.requests = []
        self.generations = []
        self.review_interactions = []

    def call(self, client, user, method, path, **kwargs):
        start = time.monotonic()
        try:
            response = client.request(method, path, headers={"Authorization": f"Bearer {accounts.create_session(user)}"}, **kwargs)
            status = response.status_code
            detail = response.text[:220] if status >= 400 else None
        except Exception as exc:
            response, status, detail = None, 0, f"{type(exc).__name__}: {exc}"
        with self.lock:
            self.requests.append({"user": user, "method": method, "path": re.sub(r"/api/generation-jobs/[^/]+", "/api/generation-jobs/{id}", path), "status": status, "latency_ms": (time.monotonic() - start) * 1000, "detail": detail})
        return response

    def report(self):
        groups = defaultdict(list)
        for row in self.requests:
            groups[f"{row['method']} {row['path']}"].append(row)
        output = {}
        for name, rows in groups.items():
            latencies = [row["latency_ms"] for row in rows]
            output[name] = {"requests": len(rows), "status_counts": dict(Counter(str(row["status"]) for row in rows)), "p50_ms": percentile(latencies, .5), "p95_ms": percentile(latencies, .95), "max_ms": round(max(latencies), 3)}
        request_latencies = [row["latency_ms"] for row in self.requests]
        ratings = [row for row in self.requests if row["method"] == "POST" and row["path"] == "/api/reviews"]
        successful_ratings = [row for row in ratings if row["status"] == 200]
        interactions = [row["latency_ms"] for row in self.review_interactions]
        return {
            "requests": len(self.requests),
            "successes": sum(200 <= row["status"] < 400 for row in self.requests),
            "errors": sum(not 200 <= row["status"] < 400 for row in self.requests),
            "status_counts": dict(Counter(str(row["status"]) for row in self.requests)),
            "latency_ms": {"p50": percentile(request_latencies, .5), "p95": percentile(request_latencies, .95), "max": round(max(request_latencies), 3) if request_latencies else None},
            "ratings": {"attempted": len(ratings), "completed": len(successful_ratings), "successful_per_student": dict(Counter(row["user"] for row in successful_ratings))},
            "rating_plus_progress_interaction": {"count": len(interactions), "errors": sum(not row["success"] for row in self.review_interactions), "p50_ms": percentile(interactions, .5), "p95_ms": percentile(interactions, .95), "max_ms": round(max(interactions), 3) if interactions else None},
            "endpoints": output,
            "error_samples": [row for row in self.requests if row["status"] >= 400 or row["status"] == 0][:8],
            "generations": self.generations,
        }


def seed_storage(store, count):
    review_store = getattr(accounts, "_review_store", None)
    with review_store.maintenance() if review_store is not None else nullcontext():
        _seed_storage(store, count)


def _seed_storage(store, count):
    store.reset(False)
    tables = [(accounts.USERS_TAB, accounts.USER_COLUMNS), (accounts.SETS_TAB, accounts.SET_COLUMNS), (accounts.USAGE_TAB, accounts.USAGE_COLUMNS), (accounts.PROGRESS_TAB, accounts.PROGRESS_COLUMNS), (accounts.REVIEWS_TAB, accounts.REVIEW_COLUMNS), (accounts.SHARES_TAB, accounts.SHARE_COLUMNS), (accounts.REPORTS_TAB, accounts.REPORT_COLUMNS), *accounts.SOCIAL_TABLES.items()]
    store.tables = {name: [list(columns)] for name, columns in tables}
    store.grid_properties.clear()
    if hasattr(accounts, "_review_grids"):
        accounts._review_grids.clear()
    accounts._schema_ready = True  # Existing configured spreadsheet; schema startup excluded.
    accounts._row_cache.clear()
    for i in range(count):
        user_id = f"synthetic-{i:03d}"
        user = {"user_id": user_id, "username": user_id, "email": f"student{i}@ceu.edu.ph", "google_sub": user_id, "display_name": user_id}
        store.tables[accounts.USERS_TAB].append([user.get(column, "") for column in accounts.USER_COLUMNS])
        profile = {"user_id": user_id, "onboarding_version": social_store.TERMS_VERSION, "terms_version": social_store.TERMS_VERSION}
        store.tables["Profiles"].append([profile.get(column, "") for column in accounts.SOCIAL_TABLES["Profiles"]])
        study_set = {"id": f"seed-{i}", "user_id": user_id, "title": "Synthetic biology", "type": "flashcards", "created_at": datetime.now(timezone.utc).isoformat(), "items": [{"card_id": f"card-{j}", "question": f"Synthetic concept {j}?", "answer": f"Synthetic answer {j}"} for j in range(10)]}
        accounts.save_study_set(study_set)


def persisted_state(store, metrics):
    with store.lock:
        reviews = [row for row in store.tables[accounts.REVIEWS_TAB][1:] if row and str(row[0]).startswith("synthetic-")]
        progress = [row for row in store.tables[accounts.PROGRESS_TAB][1:] if row and str(row[0]).startswith("synthetic-")]
        sets = [row for row in store.tables[accounts.SETS_TAB][1:] if len(row) > 1 and str(row[1]).startswith("synthetic-")]
    successful_ratings = sum(row["method"] == "POST" and row["path"] == "/api/reviews" and row["status"] == 200 for row in metrics.requests)
    return {
        "successful_rating_requests": successful_ratings,
        "persisted_review_log_rows": len(reviews),
        "persisted_progress_rows": len(progress),
        "persisted_sets": len(sets),
        "reviews_per_student": dict(Counter(row[0] for row in reviews)),
        "all_successful_ratings_persisted": len(reviews) == successful_ratings,
    }


provider_lock = threading.Lock()
provider_calls = []
provider_gate = None
provider_latency = 5.0
def simulated_provider(_provider, _model, _key, _prompt, schema, _max_tokens):
    started = time.monotonic()
    with provider_lock:
        call_id = len(provider_calls)
        provider_calls.append({"started": started, "completed": None})
    if provider_gate is not None:
        provider_gate.wait(90)
    time.sleep(provider_latency)
    count = schema["properties"]["items"].get("maxItems", 8)
    with provider_lock:
        provider_calls[call_id]["completed"] = time.monotonic()
    return {"title": "Synthetic generated biology", "items": [{"question": f"Concept {call_id * 10 + i} definition?", "answer": "A deterministic local synthetic answer.", "source_refs": []} for i in range(count)]}


MATERIAL = ("Cells contain organelles with distinct functions. Mitochondria produce ATP through cellular respiration. Ribosomes synthesize proteins. Cell membranes control movement of materials. Photosynthesis converts light to chemical energy. " * 3).encode()
def submit_generation(client, metrics, user):
    return metrics.call(client, user, "POST", "/api/generation-jobs", data={"format": "flashcards", "question_count": "10", "model": "groq:openai/gpt-oss-20b", "use_web": "false"}, files=[("files", ("synthetic-notes.txt", MATERIAL, "text/plain"))])


def wait_generation(client, metrics, user, response, start):
    if response is None or response.status_code != 202:
        return
    job_id = response.json()["job_id"]
    while time.monotonic() - start < 90:
        time.sleep(1)
        result = metrics.call(client, user, "GET", f"/api/generation-jobs/{job_id}")
        if result is not None and result.status_code == 200:
            data = result.json()
            if data["status"] in {"complete", "error"}:
                metrics.generations.append({"user": user, "status": data["status"], "elapsed_seconds": round(time.monotonic() - start, 3), "items": len(data.get("result", {}).get("items", [])), "saved": bool(data.get("result", {}).get("id")), "persistence_error": data.get("result", {}).get("persistence_error"), "error_status": data.get("error_status"), "message": data.get("message")})
                return
    metrics.generations.append({"user": user, "status": "poll_timeout"})


def run_stage(client, store, students, duration, enforce):
    # Never let a previous stage's worker write into the next stage's tables.
    deadline = time.monotonic() + 90
    while any(job["status"] in {"queued", "running"} for job in api.generation_jobs.jobs.values()):
        if time.monotonic() >= deadline:
            raise RuntimeError("Previous stage still has active generation jobs; refusing to reset storage")
        time.sleep(.1)
    seed_storage(store, students)
    api.generation_jobs = GenerationJobs()
    store.reset(enforce)
    metrics = Measurements()
    review_store = getattr(accounts, "_review_store", None)
    batch_stats_before = review_store.stats() if review_store is not None else {}
    started = time.monotonic()
    generators = max(1, math.ceil(students * .1))
    with ThreadPoolExecutor(max_workers=students + generators) as workers:
        generation_futures = []
        def student(index):
            user = f"synthetic-{index:03d}"
            time.sleep(index * .15)
            metrics.call(client, user, "GET", "/api/study-sets")
            metrics.call(client, user, "GET", "/api/progress")
            metrics.call(client, user, "GET", "/api/reviews/due")
            metrics.call(client, user, "POST", "/api/study-sets", json={"title": "Synthetic saved notes", "type": "flashcards", "items": [{"question": "What is ATP?", "answer": "A cellular energy carrier."}]})
            if index < generators:
                generation_start = time.monotonic()
                response = submit_generation(client, metrics, user)
                generation_futures.append(workers.submit(wait_generation, client, metrics, user, response, generation_start))
            tick = started + 10 + index * .15
            card = 0
            while tick < started + duration:
                time.sleep(max(0, tick - time.monotonic()))
                interaction_started = time.monotonic()
                review = metrics.call(client, user, "POST", "/api/reviews", json={"study_set_id": f"seed-{index}", "card_id": f"card-{card % 10}", "rating": "good"})
                progress = metrics.call(client, user, "GET", "/api/progress")
                with metrics.lock:
                    metrics.review_interactions.append({"user": user, "latency_ms": (time.monotonic() - interaction_started) * 1000, "success": review is not None and review.status_code == 200 and progress is not None and progress.status_code == 200})
                card += 1
                # Slow requests apply backpressure; no artificial retry storm.
                tick = max(tick + 10, time.monotonic())
        tasks = [workers.submit(student, i) for i in range(students)]
        for task in tasks:
            task.result()
        for future in generation_futures:
            future.result()
    time.sleep(max(0, started + duration - time.monotonic()))
    batch_stats = review_store.stats() if review_store is not None else {}
    batch_stats_delta = {key: value - batch_stats_before.get(key, 0) for key, value in batch_stats.items() if type(value) is int and key not in {"pending"}}
    result = {"students": students, "requested_duration_seconds": duration, "actual_duration_seconds": round(time.monotonic() - started, 3), "authentication": "real signed synthetic bearer session; original authenticated_user/onboarded_user", "quota_mode": "enforce_http_429_with_real_backend_retries" if enforce else "observe_demand_without_throttling", "generator_students": generators, "generator_fraction": generators / students, "review_batcher": {"stage_counters": batch_stats_delta, "pending_at_end": batch_stats.get("pending"), "inflight_at_end": batch_stats.get("inflight")}, "persisted_state": persisted_state(store, metrics), "sheets": store.report(), "api": metrics.report()}
    print(json.dumps({"stage": result["quota_mode"], "students": students, "seconds": result["actual_duration_seconds"], "requests": result["api"]["requests"], "errors": result["api"]["errors"], "sheets": result["sheets"]["attempts"], "quota_429s": result["sheets"]["http_429_attempts"], "generations": result["api"]["generations"]}), flush=True)
    return result


def queue_probe(client, store):
    global provider_gate, provider_latency
    seed_storage(store, 8)
    api.generation_jobs = GenerationJobs()
    store.reset(False)
    metrics = Measurements()
    provider_gate = threading.Event()
    previous_latency, provider_latency = provider_latency, 0.01
    try:
        responses = [submit_generation(client, metrics, f"synthetic-{i:03d}") for i in range(7)]
        duplicate = submit_generation(client, metrics, "synthetic-000")
        states = Counter(api.generation_jobs.get(response.json()["job_id"], f"synthetic-{i:03d}")["status"] for i, response in enumerate(responses[:6]))
        provider_gate.set()
        deadline = time.monotonic() + 30
        while time.monotonic() < deadline and any(job["status"] in {"queued", "running"} for job in api.generation_jobs.jobs.values()):
            time.sleep(.1)
        final_states = Counter(job["status"] for job in api.generation_jobs.jobs.values())
        return {"simultaneous_submit_statuses": [r.status_code for r in responses], "duplicate_account_status": duplicate.status_code, "states_while_provider_blocked": dict(states), "states_after_release": dict(final_states), "expected": "6 accepted (2 workers plus 4 queued), seventh HTTP429, duplicate-account HTTP409", "passed": [r.status_code for r in responses] == [202] * 6 + [429] and duplicate.status_code == 409 and final_states == Counter({"complete": 6}), "api": metrics.report()}
    finally:
        provider_gate.set()
        provider_gate = None
        provider_latency = previous_latency


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=ROOT / "docs" / "mixed-load-test-2026-11-01.json")
    parser.add_argument("--duration", type=float, default=65)
    parser.add_argument("--users", type=int, nargs="+", default=[1, 2, 5])
    parser.add_argument("--enforce-users", type=int, default=2)
    parser.add_argument("--resume", action="store_true", help="Retain completed stages from --output, then run missing requested stages")
    parser.add_argument("--sheets-latency-ms", type=float, default=50)
    parser.add_argument("--quota", type=int, default=60)
    parser.add_argument("--capacity-25", action="store_true", help="Run only a 130-second quota-enforced stage with 25 students and 3 generators")
    args = parser.parse_args()
    if args.capacity_25:
        args.users, args.enforce_users, args.duration = [], 25, 130
    if args.duration < 1 or min(args.users + [args.enforce_users]) < 1 or args.quota < 1 or args.sheets_latency_ms < 0:
        parser.error("Duration, users, quota must be positive; latency must be nonnegative")
    store = MemorySheets(args.sheets_latency_ms / 1000, args.quota)
    requests.request = store.transport
    api.generate_with_provider = simulated_provider
    report = {
        "created_at": datetime.now(timezone.utc).isoformat(),
        "kind": "isolated_local_mixed_workload_simulation",
        "production_capacity_claim": False,
        "runtime": {"python": sys.version, **{name: sys.modules[name].__version__ for name in ("fastapi", "starlette", "httpx", "requests")}},
        "assumptions": {
            "transport": "ASGI TestClient; no external HTTP; locally signed synthetic bearer sessions through original authentication and profile gates",
            "storage": "thread-safe memory Sheets HTTP adapter; real accounts._api retries, _rows caches, serialization and write locks",
            "schema": "preexisting headers; cold schema creation excluded",
            "sheets_latency_ms": args.sheets_latency_ms,
            "quota_model": f"{args.quota} read and {args.quota} write HTTP requests per rolling60s per service identity; synthetic model, not measured Google responses",
            "quota_resets": "each independent stage starts with an empty rolling window and fresh synthetic tables",
            "study_workload": "Each student loads library/progress/due, saves one set, then rates one card and refreshes progress every10s; synchronous backpressure after slow requests",
            "generation_workload": "10questions; real fallback engine produces batches8+2, each fake provider call sleeps5s; ceil(students/10) generators, minimum1 so small-cohort fractions exceed10%",
            "excluded": "real Google login, Google transport latency/quota billing, real model latency/quality/quotas, OCR, browser rendering, Render CPU/RAM and network/deployment conditions",
            "interpretation": "Local functional/quota-demand evidence only; not a supported concurrent-student limit",
        },
        "stages": [],
    }
    if args.resume and args.output.exists():
        previous = json.loads(args.output.read_text(encoding="utf-8"))
        if previous["assumptions"]["sheets_latency_ms"] != args.sheets_latency_ms or previous["assumptions"]["quota_model"] != report["assumptions"]["quota_model"]:
            parser.error("Cannot resume with different storage latency or quota assumptions")
        report["stages"] = previous["stages"]
        for stage in report["stages"]:
            if "authentication" not in stage:
                stage["authentication"] = "retained successful demand-only stage used synthetic identity dependency with real account lookup/profile gate; signed-token verification was added for subsequent stages"
        report["resumed_from"] = previous["created_at"]
    def completed(students, enforce):
        mode = "enforce_http_429_with_real_backend_retries" if enforce else "observe_demand_without_throttling"
        return any(stage["students"] == students and stage["quota_mode"] == mode and stage["requested_duration_seconds"] == args.duration for stage in report["stages"])
    try:
        with TestClient(api.app, raise_server_exceptions=False) as client:
            for students in args.users:
                if not completed(students, False):
                    report["stages"].append(run_stage(client, store, students, args.duration, False))
                args.output.parent.mkdir(parents=True, exist_ok=True)
                args.output.write_text(json.dumps(report, indent=2), encoding="utf-8")
            if not completed(args.enforce_users, True):
                report["stages"].append(run_stage(client, store, args.enforce_users, args.duration, True))
            report["generation_queue_probe"] = queue_probe(client, store)
    finally:
        api._generation_workers.shutdown(wait=True)
        if hasattr(accounts, "_review_store"):
            accounts._review_store.close()
    report["current_process_simulated_provider_calls_including_queue_probe"] = len(provider_calls)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(f"Saved isolated simulation: {args.output}", flush=True)
    if not report["generation_queue_probe"]["passed"]:
        raise SystemExit("Generation queue probe failed; inspect report")


if __name__ == "__main__":
    main()
