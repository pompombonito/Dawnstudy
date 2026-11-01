"""Audit production function bodies locally; no imports of API dependencies or network.

Run with Python 3.11+. Authentication, schema initialization, and study-set reads
are excluded to model warmed caches. Sheets HTTP calls use an in-memory fake.
This counts storage operations and queue limits; it does not measure user capacity.
"""

import ast
import copy
import hashlib
import importlib.util
import json
from collections import Counter
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
from pathlib import Path
import re
import threading
import time
from types import SimpleNamespace
from urllib.parse import quote, unquote


ROOT = Path(__file__).resolve().parents[1]


def extract_functions(tree, names, namespace, source_path):
    nodes = []
    found = set()
    for original in tree.body:
        if isinstance(original, ast.FunctionDef) and original.name in names:
            node = copy.deepcopy(original)
            node.decorator_list = []
            node.returns = None
            for argument in [*node.args.posonlyargs, *node.args.args, *node.args.kwonlyargs]:
                argument.annotation = None
            # Dependency injection normally supplies these arguments; the audit
            # supplies a fixture user directly instead of invoking authentication.
            node.args.defaults = [ast.Constant(None) if isinstance(value, ast.Call) else value for value in node.args.defaults]
            nodes.append(node)
            found.add(node.name)
    if found != set(names):
        raise AssertionError(f"Missing production functions: {set(names) - found}")
    module = ast.fix_missing_locations(ast.Module(body=nodes, type_ignores=[]))
    exec(compile(module, str(source_path), "exec"), namespace)


def storage_namespace(tree):
    namespace = {"threading": threading, "time": time, "quote": quote, "re": re, "StorageError": RuntimeError}
    names = {
        "USERS_TAB", "SETS_TAB", "PROGRESS_TAB", "REVIEWS_TAB", "PROGRESS_COLUMNS",
        "REVIEW_COLUMNS", "SOCIAL_TABLES", "_row_cache_ttl", "_row_cache_max_characters",
        "_cached_row_tabs",
    }
    for node in tree.body:
        if isinstance(node, ast.Assign) and any(isinstance(target, ast.Name) and target.id in names for target in node.targets):
            exec(compile(ast.Module(body=[node], type_ignores=[]), "accounts.py", "exec"), namespace)
    spec = importlib.util.spec_from_file_location("audited_review_store", ROOT / "backend/review_store.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    namespace.update(_review_grid_lock=threading.Lock(), _review_grids={namespace["PROGRESS_TAB"]: (0, 1000), namespace["REVIEWS_TAB"]: (1, 1000)}, ensure_schema=lambda: None, ReviewStoreError=module.ReviewStoreError)
    extract_functions(tree, {"_parse_rows", "_load_review_rows", "_write_review_rows", "review_transaction", "review_data", "save_card_review"}, namespace, ROOT / "backend/accounts.py")
    namespace["review_transaction"] = contextmanager(namespace["review_transaction"])
    namespace["_review_store"] = module.BatchedReviewStore(
        load=lambda: namespace["_load_review_rows"](), write=lambda body: namespace["_write_review_rows"](body),
        progress_columns=namespace["PROGRESS_COLUMNS"], review_columns=namespace["REVIEW_COLUMNS"], flush_seconds=0.001,
    )
    return namespace


class FixtureHTTPException(Exception):
    def __init__(self, status_code, detail):
        super().__init__(detail)
        self.status_code = status_code


def audit_review(accounts_tree, main_tree, existing):
    storage = storage_namespace(accounts_tree)
    columns = {storage["PROGRESS_TAB"]: storage["PROGRESS_COLUMNS"], storage["REVIEWS_TAB"]: storage["REVIEW_COLUMNS"]}
    tables = {tab: [list(header)] for tab, header in columns.items()}
    user = {"user_id": "fixture-student"}
    if existing:
        prior = {"user_id": user["user_id"], "set_id": "fixture-set", "card_id": "fixture-card", "due_at": "2026-01-01T00:00:00+00:00", "interval_days": "1", "ease_factor": "2.5", "repetitions": "1", "lapses": "0", "last_reviewed_at": "2026-01-01T00:00:00+00:00", "last_rating": "good"}
        tables[storage["PROGRESS_TAB"]].append([prior.get(column, "") for column in columns[storage["PROGRESS_TAB"]]])
    calls = []

    def fake_api(method, path, *, params=None, body=None):
        if method == "GET" and path == "/values:batchGet":
            targets = [unquote(target).split("!", 1)[0] for target in params["ranges"]]
            calls.append({"method": method, "operation": "values.batchGet", "tables": targets})
            return {"valueRanges": [{"values": copy.deepcopy(tables[tab])} for tab in targets]}
        if method == "POST" and path == "/values:batchUpdate":
            targets = []
            for entry in body["data"]:
                tab, cell_range = entry["range"].split("!", 1)
                if tab not in tables:
                    raise AssertionError(f"Unexpected table: {tab}")
                targets.append(tab)
                row_number = int(re.findall(r"\d+", cell_range)[0])
                while len(tables[tab]) < row_number:
                    tables[tab].append([])
                tables[tab][row_number - 1] = copy.deepcopy(entry["values"][0])
            calls.append({"method": method, "operation": "values.batchUpdate", "tables": list(dict.fromkeys(targets)), "ranges": len(body["data"])})
            return {}
        raise AssertionError(f"Unexpected Sheets operation: {method} {path}")

    storage["_api"] = fake_api
    study_sets = [{"id": "fixture-set", "title": "Fixture", "type": "flashcards", "items": [{"card_id": "fixture-card", "question": "Fixture question", "answer": "Fixture answer"}]}]
    namespace = {
        "datetime": datetime, "timedelta": timedelta, "timezone": timezone, "hashlib": hashlib,
        "HTTPException": FixtureHTTPException, "StorageError": RuntimeError,
        "list_study_sets": lambda user_id: copy.deepcopy(study_sets),
        "review_data": storage["review_data"], "save_card_review": storage["save_card_review"],
        "review_transaction": storage["review_transaction"],
        "storage_http_error": lambda exception: exception,
    }
    def summarize(operations):
        counts = Counter(operation["method"] for operation in operations)
        return {"reads": counts["GET"], "writes": counts["POST"] + counts["PUT"], "operations": operations}

    extract_functions(main_tree, {"_manila_now", "_interval_label", "grade_review", "_grade_review", "get_study_progress"}, namespace, ROOT / "backend/main.py")
    try:
        request = SimpleNamespace(study_set_id="fixture-set", card_id="fixture-card", rating="good")
        result = namespace["grade_review"](request, user)
        assert result["rating"] == "good"
        post_calls = copy.deepcopy(calls)
        progress = namespace["get_study_progress"](user)
        assert progress["total_reviews"] == 1
        refresh_calls = copy.deepcopy(calls[len(post_calls):])
        combined_calls = copy.deepcopy(calls)
        hot_start = len(calls)
        namespace["grade_review"](request, user)
        progress = namespace["get_study_progress"](user)
        assert progress["total_reviews"] == 2
        hot_calls = copy.deepcopy(calls[hot_start:])
        assert len(tables[storage["PROGRESS_TAB"]]) == 2
        assert len(tables[storage["REVIEWS_TAB"]]) == 3
        output = {"existing_card": existing, "post_review_cold_review_cache": summarize(post_calls), "get_progress_refresh": summarize(refresh_calls), "first_combined_interaction": summarize(combined_calls), "next_interaction_warm_review_cache": summarize(hot_calls), "store_metrics": storage["_review_store"].stats()}
        assert output["first_combined_interaction"]["reads"] == 1
        assert output["first_combined_interaction"]["writes"] == 1
        assert output["get_progress_refresh"]["reads"] == 0
        assert output["get_progress_refresh"]["writes"] == 0
        assert output["next_interaction_warm_review_cache"]["reads"] == 0
        assert output["next_interaction_warm_review_cache"]["writes"] == 1
        return output
    finally:
        storage["_review_store"].close()


def audit_generation(main_tree):
    path = ROOT / "backend/generation_jobs.py"
    spec = importlib.util.spec_from_file_location("audited_generation_jobs", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    store = module.GenerationJobs()
    admitted = [store.start(f"fixture-{index}", 10) for index in range(6)]
    assert len(admitted) == 6
    duplicate_rejected = False
    try:
        store.start("fixture-0", 10)
    except module.GenerationAlreadyRunning:
        duplicate_rejected = True
    seventh_rejected = False
    try:
        store.start("fixture-6", 10)
    except module.GenerationQueueFull:
        seventh_rejected = True
    assert duplicate_rejected and seventh_rejected
    workers = next(ast.literal_eval(keyword.value) for node in main_tree.body if isinstance(node, ast.Assign) and any(isinstance(target, ast.Name) and target.id == "_generation_workers" for target in node.targets) for keyword in node.value.keywords if keyword.arg == "max_workers")
    assert workers == 2
    return {"background_workers_from_production_ast": workers, "active_jobs_admitted": len(admitted), "seventh_distinct_account_rejected": seventh_rejected, "same_account_duplicate_rejected": duplicate_rejected, "scope": "Background generation queue only; direct /api/generate route is not covered."}


def main():
    accounts_tree = ast.parse((ROOT / "backend/accounts.py").read_text(encoding="utf-8"))
    main_tree = ast.parse((ROOT / "backend/main.py").read_text(encoding="utf-8"))
    report = {
        "audit_type": "local execution of extracted production function bodies with in-memory Sheets I/O",
        "external_requests": 0,
        "exclusions": ["Authentication and profile checks", "Schema initialization", "Study-set reads (assumed warm)", "Grid metadata (prewarmed with 1000 rows per review table) and grid expansion", "Network latency, quota enforcement, retries, provider calls, and real server throughput"],
        "audit_flush_seconds": 0.001,
        "card_review_scenarios": [audit_review(accounts_tree, main_tree, existing=False), audit_review(accounts_tree, main_tree, existing=True)],
        "generation_queue": audit_generation(main_tree),
        "capacity_claim": "Operation counts and configured admission boundaries only; no measured maximum user capacity.",
    }
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
