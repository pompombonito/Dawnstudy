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


class GenerationJobs:
    def __init__(self, capacity=6, retention=900, clock=time.monotonic):
        self.capacity = capacity
        self.retention = retention
        self.clock = clock
        self.jobs = {}
        self.lock = threading.Lock()

    def _prune(self):
        now = self.clock()
        expired = [key for key, job in self.jobs.items()
                   if job["status"] in {"complete", "error"} and now - job["updated"] > self.retention]
        for key in expired:
            self.jobs.pop(key)

    @staticmethod
    def _public(job_id, job):
        return deepcopy({"job_id": job_id, **{key: value for key, value in job.items()
                         if key not in {"user_id", "updated", "acknowledged"}}})

    def start(self, user_id, requested):
        with self.lock:
            self._prune()
            active = [(key, job) for key, job in self.jobs.items() if job["status"] in {"queued", "running"}]
            existing = next((key for key, job in active if job["user_id"] == user_id), None)
            if existing:
                raise GenerationAlreadyRunning(existing)
            if len(active) >= self.capacity:
                raise GenerationQueueFull()
            job_id = str(uuid4())
            self.jobs[job_id] = {
                "user_id": user_id, "status": "queued", "stage": "queued",
                "message": "Waiting for a generation slot…", "completed": 0,
                "requested": requested, "updated": self.clock(), "acknowledged": False,
            }
            return job_id

    def update(self, job_id, **fields):
        with self.lock:
            self.jobs[job_id].update(fields, updated=self.clock())

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
                pair[1]["status"] in {"queued", "running"}, pair[1]["updated"]))
            if job["status"] in {"complete", "error"} and job["acknowledged"]:
                return None
            return self._public(job_id, job)

    def acknowledge(self, job_id, user_id):
        with self.lock:
            job = self.jobs.get(job_id)
            if not job or job["user_id"] != user_id:
                return False
            if job["status"] in {"complete", "error"}:
                job["acknowledged"] = True
            return True


def merge_continued_generation(base, generated):
    """Retain old cards and IDs while appending unique new questions."""
    target = base.get("requested_count") or len(base["items"])
    items, seen = [], set()
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
        "incomplete": len(items) < target, "source_url": base.get("source_url", ""),
        "page_ranges": base.get("page_ranges", {}), "focus_topic": base.get("focus_topic", ""),
        "material_fingerprint": base.get("material_fingerprint", ""),
        "models_used": list(dict.fromkeys([*base.get("models_used", []), *generated.get("models_used", [])])),
        "continued_set_id": base["id"],
    }
