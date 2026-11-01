"""Single-worker, durable Sheets review batching with committed-data caching."""
from contextlib import contextmanager
from copy import deepcopy
import json
import threading
import time


class ReviewStoreError(RuntimeError):
    pass


def _column(number):
    result = ""
    while number:
        number, remainder = divmod(number - 1, 26)
        result = chr(65 + remainder) + result
    return result


class BatchedReviewStore:
    """Callbacks perform full-table load and one RAW values.batchUpdate write.

    Callers must use transaction(key) around reading/calculating/saving a card.
    The store assumes one API process and no other writer to the review tables.
    """
    def __init__(self, load, write, progress_columns, review_columns, flush_seconds=2.0, refresh_seconds=60):
        self._load, self._write = load, write
        self._columns = (tuple(progress_columns), tuple(review_columns))
        self._flush_seconds, self._refresh_seconds = flush_seconds, refresh_seconds
        self._condition = threading.Condition(threading.RLock())
        self._local = threading.local()
        self._active, self._maintenance_owner = 0, None
        self._closing = self._closed = self._loading = self._loaded = self._inflight = False
        self._progress, self._logs, self._reserved, self._key_locks = {}, {}, {}, {}
        self._next_progress = self._next_log = 2
        self._pending, self._deadline, self._loaded_at = [], None, 0.0
        self._metrics = {"loads": 0, "batches": 0, "write_attempts": 0, "committed_reviews": 0, "failed_reviews": 0}
        self._worker = threading.Thread(target=self._run, name="review-batches", daemon=True)
        self._worker.start()

    @contextmanager
    def _operation(self):
        depth = getattr(self._local, "depth", 0)
        if depth:
            self._local.depth += 1
            try:
                yield
            finally:
                self._local.depth -= 1
            return
        with self._condition:
            while self._maintenance_owner is not None:
                self._condition.wait()
            if self._closing or self._closed:
                raise ReviewStoreError("Review storage is shutting down.")
            self._active += 1
        self._local.depth = 1
        try:
            yield
        finally:
            self._local.depth = 0
            with self._condition:
                self._active -= 1
                self._condition.notify_all()

    def _ensure_loaded(self):
        with self._condition:
            while self._loading:
                self._condition.wait()
            refresh = time.monotonic() - self._loaded_at >= self._refresh_seconds
            if self._loaded and (not refresh or self._pending or self._inflight):
                return
            self._loading = True
        try:
            progress, logs = self._load()
            progress = {number: dict(row) for number, row in progress}
            logs = {number: dict(row) for number, row in logs}
        except Exception as error:
            with self._condition:
                self._loading = False
                self._condition.notify_all()
            raise ReviewStoreError("Could not load review storage.") from error
        with self._condition:
            self._progress, self._logs = progress, logs
            # Never reuse an uncertain write's reservations within this process.
            self._next_progress = max(self._next_progress, max(progress, default=1) + 1)
            self._next_log = max(self._next_log, max(logs, default=1) + 1)
            self._reserved = {(row["user_id"], row["set_id"], row["card_id"]): number for number, row in progress.items() if row.get("user_id") and row.get("set_id") and row.get("card_id")}
            self._loaded_at, self._loaded, self._loading = time.monotonic(), True, False
            self._metrics["loads"] += 1
            self._condition.notify_all()

    def data(self, user):
        with self._operation():
            while True:
                self._ensure_loaded()
                with self._condition:
                    if self._loaded and not self._loading:
                        return ([dict(row) for row in self._progress.values() if row.get("user_id") == user],
                                [dict(row) for row in self._logs.values() if row.get("user_id") == user])

    @contextmanager
    def transaction(self, key):
        key = tuple(key)
        with self._operation():
            with self._condition:
                lock, references = self._key_locks.get(key, (threading.RLock(), 0))
                self._key_locks[key] = (lock, references + 1)
            try:
                with lock:
                    yield
            finally:
                with self._condition:
                    references = self._key_locks[key][1] - 1
                    if references:
                        self._key_locks[key] = (lock, references)
                    else:
                        self._key_locks.pop(key)

    def _payload(self, entries):
        progress, logs = {}, {}
        for entry in entries:
            progress[entry["progress_row"]] = entry["progress"]
            logs[entry["log_row"]] = entry["review"]
        data = []
        for tab, columns, records in (("CardProgress", self._columns[0], progress), ("ReviewLogs", self._columns[1], logs)):
            for number, record in records.items():
                data.append({"range": f"{tab}!A{number}:{_column(len(columns))}{number}", "majorDimension": "ROWS", "values": [[str(record.get(column, "")) for column in columns]]})
        return {"valueInputOption": "RAW", "data": data}

    def save(self, user, set_id, card_id, progress, review):
        with self._operation():
            while True:
                self._ensure_loaded()
                with self._condition:
                    # Another batch can fail between loading and admission.
                    if not self._loaded or self._loading:
                        continue
                    key = (user, set_id, card_id)
                    if key not in self._reserved:
                        self._reserved[key] = self._next_progress
                        self._next_progress += 1
                    entry = {"progress_row": self._reserved[key], "log_row": self._next_log,
                             "progress": dict(progress), "review": dict(review), "event": threading.Event(), "error": None}
                    self._next_log += 1
                    if len(json.dumps(self._payload([entry])).encode("utf-8")) > 1_000_000:
                        raise ReviewStoreError("This review is too large to save.")
                    self._pending.append(entry)
                    if self._deadline is None:
                        self._deadline = time.monotonic() + self._flush_seconds
                    self._condition.notify_all()
                    break
            entry["event"].wait()
            if entry["error"] is not None:
                raise entry["error"]

    def _run(self):
        while True:
            with self._condition:
                while not self._pending:
                    if self._closed:
                        return
                    self._condition.wait()
                remaining = self._deadline - time.monotonic()
                if remaining > 0 and not self._closing:
                    self._condition.wait(remaining)
                    continue
                batch = []
                while self._pending:
                    candidate = batch + [self._pending[0]]
                    payload = self._payload(candidate)
                    if batch and (len(payload["data"]) > 256 or len(json.dumps(payload).encode("utf-8")) > 1_000_000):
                        break
                    batch.append(self._pending.pop(0))
                payload = self._payload(batch)
                self._deadline = time.monotonic() if self._pending else None
                self._inflight = True
            failure = None
            for attempt in range(2):
                try:
                    with self._condition:
                        self._metrics["write_attempts"] += 1
                    self._write(deepcopy(payload))
                    failure = None
                    break
                except Exception as error:
                    failure = error
            with self._condition:
                self._inflight = False
                if failure is None:
                    for entry in batch:
                        self._progress[entry["progress_row"]] = dict(entry["progress"])
                        self._logs[entry["log_row"]] = dict(entry["review"])
                    self._metrics["batches"] += 1
                    self._metrics["committed_reviews"] += len(batch)
                else:
                    # A timeout can mean committed data. Reload before admitting
                    # another write, and never expose these uncertain rows locally.
                    batch += self._pending
                    self._pending, self._deadline, self._loaded = [], None, False
                    self._metrics["failed_reviews"] += len(batch)
                    for entry in batch:
                        entry["error"] = ReviewStoreError("Could not durably save the review. Please try again.")
                        entry["error"].__cause__ = failure
                for entry in batch:
                    entry["event"].set()
                self._condition.notify_all()

    @contextmanager
    def maintenance(self):
        if getattr(self._local, "depth", 0):
            raise ReviewStoreError("Maintenance cannot run inside a review transaction.")
        owner = threading.get_ident()
        with self._condition:
            if self._maintenance_owner == owner:
                raise ReviewStoreError("Nested review maintenance is not supported.")
            while self._maintenance_owner is not None:
                self._condition.wait()
            self._maintenance_owner = owner
            if self._pending:
                self._deadline = time.monotonic()
                self._condition.notify_all()
            while self._active or self._inflight or self._loading:
                self._condition.wait()
        try:
            yield
        finally:
            with self._condition:
                self._loaded = False
                self._maintenance_owner = None
                self._condition.notify_all()

    def invalidate(self):
        if self._maintenance_owner == threading.get_ident():
            with self._condition:
                self._loaded = False
            return
        with self.maintenance():
            pass

    def stats(self):
        with self._condition:
            return {**self._metrics, "pending": len(self._pending), "inflight": self._inflight}

    def close(self):
        if getattr(self._local, "depth", 0):
            raise ReviewStoreError("Review storage cannot close inside a transaction.")
        with self._condition:
            self._closing = True
            self._condition.notify_all()
            while self._active or self._inflight or self._loading:
                self._condition.wait()
            self._closed = True
            self._condition.notify_all()
        self._worker.join()
