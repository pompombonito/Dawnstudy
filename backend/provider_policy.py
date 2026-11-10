"""Per-job model routing and failure budgets, independent of provider clients.

The caller supplies verified vision capabilities. Routing never interprets or
changes a questionnaire's supplied answers, and this module stores no keys.
"""

from collections import OrderedDict
from itertools import count
from threading import Lock


_rotations = count()
_rotation_lock = Lock()


def next_provider_rotation():
    """Spread automatic jobs across providers within this worker process."""
    with _rotation_lock:
        return next(_rotations)


def order_model_candidates(models, selected_model=None, *, task="text",
                           supports_images=None, rotation=0):
    """Return unique candidates, alternating providers before sibling models.

    Choices retain the existing (id, provider, model, key, label) structure.
    Explicit selection remains first when it can perform the task. Vision and
    OCR jobs exclude models without confirmed image capability; a text model
    cannot substitute for a model that actually receives the required pixels.
    Successful repeated batches do not consume the failure budget below.
    """
    if task not in {"text", "vision", "ocr"}:
        raise ValueError("Unknown provider task")
    eligible, seen = [], set()
    for choice in models:
        model_id, provider, model = choice[:3]
        if model_id in seen:
            continue
        if task != "text" and (supports_images is None or not supports_images(provider, model)):
            continue
        seen.add(model_id)
        eligible.append(choice)
    primary = next((choice for choice in eligible if choice[0] == selected_model), None)
    groups = OrderedDict()
    for choice in eligible:
        if choice is not primary:
            groups.setdefault(choice[1], []).append(choice)
    providers = list(groups)
    if providers:
        offset = rotation % len(providers)
        providers = providers[offset:] + providers[:offset]
        # After an explicit primary, try another provider before another model
        # sharing its account and quota. This also avoids immediate 429 loops.
        if primary and len(providers) > 1 and providers[0] == primary[1]:
            providers = providers[1:] + providers[:1]
    ordered = [primary] if primary else []
    while providers:
        remaining = []
        for provider in providers:
            ordered.append(groups[provider].pop(0))
            if groups[provider]:
                remaining.append(provider)
        providers = remaining
    return ordered


def questionnaire_needs_vision(records):
    """Use visible evidence when an attached-figure question lacks its answer.

    A provided answer remains authoritative. Filling text distractors for an
    already answered question can use text models, without re-solving it.
    """
    return any(isinstance(record, dict) and record.get("images")
               and not str(record.get("answer") or "").strip() for record in records)


def eligible_questionnaire_records(records, supports_images):
    """Keep text-only models away from unanswered image-dependent records.

    Mixed batches can still progress: a text model may fill text questions and
    distractors for supplied answers, while image questions wait for a vision
    provider. Call completion validation against this same eligible subset.
    """
    return [record for record in records if isinstance(record, dict)
            and (supports_images or not record.get("images")
                 or (str(record.get("answer") or "").strip()
                     and not record.get("explanation_requires_vision")))]


def interleave_order(primary, candidates, *, rotation=0):
    """Drop-in ordering helper for existing primary/candidate fallback loops."""
    return order_model_candidates(([primary] if primary else []) + list(candidates),
                                  primary[0] if primary else None, rotation=rotation)


class ProviderAttemptPolicy:
    """Share failures across all batches in one generation job.

    Authentication and quota failures block sibling models immediately. Other
    failed models are attempted once, with at most two failed models per
    provider by default. Successful batches remain unlimited, so a large quiz
    can finish on a healthy model. No cooldown is shared between students or
    persisted after the job, avoiding stale process-wide quota assumptions.
    """

    def __init__(self, max_failures_per_provider=2):
        if max_failures_per_provider < 1:
            raise ValueError("A provider failure budget must be positive")
        self.max_failures_per_provider = max_failures_per_provider
        self.failed_models = set()
        self.provider_failures = {}
        self.blocked_providers = {}

    def can_attempt(self, provider, model):
        return (provider not in self.blocked_providers
                and (provider, model) not in self.failed_models
                and self.provider_failures.get(provider, 0) < self.max_failures_per_provider)

    def skip_model(self, provider, model):
        """Skip a temporarily unsuitable model without charging its provider budget."""
        self.failed_models.add((provider, model))

    def record_failure(self, provider, model, status=None):
        """Record a final failed call, after any supported JSON/size retry."""
        identity = (provider, model)
        if identity in self.failed_models:
            return
        self.failed_models.add(identity)
        self.provider_failures[provider] = self.provider_failures.get(provider, 0) + 1
        if status in {401, 403}:
            self.blocked_providers[provider] = "authorization"
        elif status == 429:
            self.blocked_providers[provider] = "quota"
        elif self.provider_failures[provider] >= self.max_failures_per_provider:
            self.blocked_providers[provider] = "unavailable"
