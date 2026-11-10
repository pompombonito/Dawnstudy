"""Account-scoped tracking for background generations and refresh recovery."""
import re
import threading
import time
from copy import deepcopy
from uuid import uuid4


class GenerationAlreadyRunning(Exception):
    def __init__(self, job_id):
        self.job_id = job_id


class GenerationQueueFull(Exception):
    pass


class GenerationCancelled(Exception):
    """A worker reached a cancellation checkpoint before durable saving began."""


class GenerationDeferred(Exception):
    """Release a worker while retaining a job until upstream capacity returns."""

    def __init__(self, retry_after=30):
        self.retry_after = max(1, retry_after)


class GenerationJobs:
    ACTIVE = {"queued", "running", "cancelling"}
    TERMINAL = {"complete", "error", "cancelled"}

    def __init__(self, capacity=6, retention=900, clock=time.monotonic):
        self.capacity = capacity
        self.retention = retention
        self.clock = clock
        self.jobs = {}
        self.lock = threading.Lock()

    def _prune(self):
        now = self.clock()
        expired = [key for key, job in self.jobs.items()
                   if job["status"] in self.TERMINAL and now - job["updated"] > self.retention]
        for key in expired:
            self.jobs.pop(key)

    @staticmethod
    def _public(job_id, job):
        return deepcopy({"job_id": job_id,
                         "can_cancel": job["status"] in {"queued", "running"} and not job.get("_committing", False),
                         **{key: value for key, value in job.items()
                            if key not in {"user_id", "updated", "acknowledged", "_cancel_event", "_committing"}}})

    def start(self, user_id, requested, job_id=None):
        with self.lock:
            self._prune()
            if job_id in self.jobs:
                # Do not disclose another account's client-chosen identifier.
                if self.jobs[job_id]["user_id"] == user_id:
                    raise GenerationAlreadyRunning(job_id)
                raise ValueError("This request identifier is unavailable.")
            active = [(key, job) for key, job in self.jobs.items() if job["status"] in self.ACTIVE]
            existing = next((key for key, job in active if job["user_id"] == user_id), None)
            if existing:
                raise GenerationAlreadyRunning(existing)
            if len(active) >= self.capacity:
                raise GenerationQueueFull()
            job_id = job_id or str(uuid4())
            self.jobs[job_id] = {
                "user_id": user_id, "status": "queued", "stage": "queued",
                "message": "Waiting for a generation slot…", "completed": 0,
                "requested": requested, "updated": self.clock(), "acknowledged": False,
                "_cancel_event": threading.Event(), "_committing": False,
            }
            return job_id

    def update(self, job_id, **fields):
        with self.lock:
            job = self.jobs.get(job_id)
            if not job or job["status"] in self.TERMINAL:
                return False
            if "completed" in fields:
                # Reading/preparation callbacks default to zero on a retry.
                # Verified work belongs to this job and cannot be lost merely
                # because its worker or provider is starting another attempt.
                fields["completed"] = max(job["completed"], fields["completed"])
            if job["status"] == "cancelling":
                # A provider can finish after cancellation was requested. Its
                # progress callback must not make the job appear active again.
                job.update({key: value for key, value in fields.items() if key in {"completed", "model"}}, updated=self.clock())
                return False
            job.update(fields, updated=self.clock())
            return True

    def discard_unaccepted(self, job_id):
        """Roll back admission when upload-memory capacity rejects submission."""
        with self.lock:
            job = self.jobs.get(job_id)
            if job and job["status"] == "queued" and not job.get("checkpoint"):
                self.jobs.pop(job_id)

    def cancel(self, job_id, user_id):
        """Request cancellation of an owned job; repeats and terminal jobs are safe."""
        with self.lock:
            self._prune()
            job = self.jobs.get(job_id)
            if not job or job["user_id"] != user_id:
                return None
            if job["status"] in self.TERMINAL or job.get("_committing"):
                return self._public(job_id, job)
            job["_cancel_event"].set()
            queued = job["status"] == "queued"
            job.update(status="cancelled" if queued else "cancelling",
                       stage="cancelled" if queued else "cancelling",
                       message="Generation cancelled." if queued else "Cancelling after the current request finishes…",
                       updated=self.clock())
            return self._public(job_id, job)

    def is_cancelled(self, job_id):
        with self.lock:
            job = self.jobs.get(job_id)
            return job is None or job["_cancel_event"].is_set()

    def raise_if_cancelled(self, job_id):
        if self.is_cancelled(job_id):
            raise GenerationCancelled()

    def finish_cancelled(self, job_id):
        """Acknowledge that the worker stopped, releasing its admission slot."""
        with self.lock:
            job = self.jobs.get(job_id)
            if job is None:
                return None
            if job["_cancel_event"].is_set() and not job.get("_committing"):
                job.update(status="cancelled", stage="cancelled", message="Generation cancelled.", updated=self.clock())
            return self._public(job_id, job)

    def begin_commit(self, job_id):
        """Fence cancellation before the first durable write to preserve saved work."""
        with self.lock:
            job = self.jobs.get(job_id)
            if job is None or job["_cancel_event"].is_set():
                raise GenerationCancelled()
            if job["status"] in self.TERMINAL:
                return False
            job.update(_committing=True, status="running", stage="saving", message="Saving your study set…", updated=self.clock())
            return True

    def defer(self, job_id, message):
        """Keep admission and progress while releasing a worker for a retry."""
        with self.lock:
            job = self.jobs.get(job_id)
            if not job or job["_cancel_event"].is_set():
                return False
            if job["status"] in self.TERMINAL:
                return False
            job.update(status="queued", stage="waiting", message=message,
                       _committing=False, updated=self.clock())
            return True

    def get(self, job_id, user_id):
        with self.lock:
            self._prune()
            job = self.jobs.get(job_id)
            return self._public(job_id, job) if job and job["user_id"] == user_id else None

    def recover(self, user_id):
        with self.lock:
            self._prune()
            candidates = [(key, job) for key, job in self.jobs.items() if job["user_id"] == user_id]
            if not candidates:
                return None
            job_id, job = max(reversed(candidates), key=lambda pair: (
                pair[1]["status"] in self.ACTIVE, pair[1]["updated"]))
            if job["status"] in self.TERMINAL and job["acknowledged"]:
                return None
            return self._public(job_id, job)

    def acknowledge(self, job_id, user_id):
        with self.lock:
            job = self.jobs.get(job_id)
            if not job or job["user_id"] != user_id:
                return False
            if job["status"] in self.TERMINAL:
                job["acknowledged"] = True
            return True


def merge_continued_generation(base, generated):
    """Retain old cards and IDs while appending unique new questions."""
    target = base.get("requested_count") or len(base["items"])
    items, seen = [], set()
    questionnaire = bool(base["items"]) and all(item.get("imported") for item in [*base["items"], *generated["items"]])
    if questionnaire:
        # A questionnaire may legitimately repeat the same stem with different
        # figures/choices. Its parsed position is identity, not its wording.
        def identity(item):
            if item.get("questionnaire_index") is not None:
                return ("position", str(item["questionnaire_index"]))
            if item.get("card_id"):
                return ("card", item["card_id"])
            return ("source", str(item.get("source_number", "")),
                    tuple(item.get("source_refs", [])), str(item.get("question", "")))

        by_position = {identity(item): item for item in base["items"]}
        by_card = {item["card_id"]: item for item in base["items"] if item.get("card_id")}
        retained_cards = set()
        for item in generated["items"]:
            old = by_position.get(identity(item)) or by_card.get(item.get("card_id"))
            # The converter carries source text/figure repairs. Preserve the
            # previous answer and review identity while accepting those repairs.
            if old:
                protected = {key: old[key] for key in ("card_id", "answer", "correct_answer", "answer_origin", "matching_pairs") if key in old}
                item = {**old, **item, **protected}
                if item.get("explanation_origin") in {"provided", "ai"} and str(item.get("explanation") or "").strip():
                    item.pop("explanation_pending", None)
                if old.get("card_id"):
                    retained_cards.add(old["card_id"])
            key = identity(item)
            if key not in seen and len(items) < target:
                seen.add(key)
                items.append(item)
        for item in base["items"]:
            key = identity(item)
            if key not in seen and item.get("card_id") not in retained_cards and len(items) < target:
                seen.add(key)
                items.append(item)
        if all(item.get("questionnaire_index") is not None for item in items):
            items.sort(key=lambda item: int(item["questionnaire_index"]))
    else:
        for item in [*base["items"], *generated["items"]]:
            key = re.sub(r"[\W_]+", " ", str(item.get("question") or "").casefold()).strip()
            if key and key not in seen and len(items) < target:
                seen.add(key)
                items.append(item)
    sources = {source["url"]: source for source in [*base.get("sources", []), *generated.get("sources", [])]}
    return {
        **base, **generated, "id": base["id"], "created_at": base["created_at"],
        "title": base["title"], "type": base["type"], "items": items,
        "sources": list(sources.values())[:20], "requested_count": target,
        "incomplete": len(items) < target or any(item.get("explanation_pending") for item in items), "source_url": base.get("source_url", ""),
        "page_ranges": base.get("page_ranges", {}), "focus_topic": base.get("focus_topic", ""),
        "material_fingerprint": base.get("material_fingerprint", ""),
        "models_used": list(dict.fromkeys([*base.get("models_used", []), *generated.get("models_used", [])])),
        "continued_set_id": base["id"],
    }
