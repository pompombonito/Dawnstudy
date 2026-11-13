"""Read provider retry hints without making requests or assuming quota availability.

Hints specify the earliest retry, not a promise that a request will succeed.
Callers still enforce cancellation, failure budgets and any job deadline. This
module deliberately does not clip a long delay into an earlier, unsafe retry.
"""

import math
import re
import time
from collections.abc import Mapping
from datetime import timezone
from email.utils import parsedate_to_datetime


def _nonnegative_number(value):
    if isinstance(value, bool):
        return None
    try:
        number = float(value)
    except (TypeError, ValueError, OverflowError):
        return None
    return number if math.isfinite(number) and number >= 0 else None


def parse_retry_after(value, *, now=None):
    """Return seconds from Retry-After's delay-seconds or HTTP-date forms.

    Fractional seconds are accepted because compatible APIs use them even
    though RFC 9110's delay-seconds grammar is integral. Invalid, negative and
    nonfinite numbers are absent hints; a valid past HTTP-date means zero.
    """
    if not isinstance(value, (str, int, float)) or isinstance(value, bool):
        return None
    if isinstance(value, str):
        value = value.strip()
        if not value or len(value) > 128:
            return None
    number = _nonnegative_number(value)
    if number is not None:
        return number
    if not isinstance(value, str):
        return None
    try:
        date = parsedate_to_datetime(value)
        if date is None:
            return None
        if date.tzinfo is None:
            date = date.replace(tzinfo=timezone.utc)
        delay = date.timestamp() - (time.time() if now is None else now)
    except (TypeError, ValueError, OverflowError, OSError):
        return None
    return max(0.0, delay) if math.isfinite(delay) else None


def parse_reset_duration(value):
    """Read provider durations such as 7.66s, 2m59.56s or 1h2m3s."""
    if not isinstance(value, str):
        return None
    value = value.strip()
    if not value or len(value) > 128:
        return None
    # Full-string validation rejects partial parses and repeated/out-of-order
    # units, preventing a malformed value from becoming an immediate retry.
    match = re.fullmatch(
        r"(?:(\d+(?:\.\d+)?)h)?(?:(\d+(?:\.\d+)?)m)?"
        r"(?:(\d+(?:\.\d+)?)s)?(?:(\d+(?:\.\d+)?)ms)?", value,
    )
    if not match or not any(part is not None for part in match.groups()):
        return None
    delay = sum(float(part) * scale for part, scale in zip(match.groups(), (3600, 60, 1, .001)) if part is not None)
    return delay if math.isfinite(delay) else None


def retry_delay_from_response(headers, body=None, *, now=None):
    """Extract the strongest documented retry hint from a failed response.

    Reads HTTP Retry-After, Google's google.rpc.RetryInfo retryDelay and Groq
    reset durations for exhausted budgets. Reset headers are always present
    on some APIs; only a corresponding remaining count of zero qualifies.
    When several exhausted budgets supply hints, honor the longest one.
    Response messages are never parsed, returned or logged.
    """
    normalized = {str(key).lower(): value for key, value in headers.items()} if isinstance(headers, Mapping) else {}
    delays = []
    retry_after = parse_retry_after(normalized.get("retry-after"), now=now)
    if retry_after is not None:
        delays.append(retry_after)
    error = body.get("error") if isinstance(body, dict) else None
    details = error.get("details") if isinstance(error, dict) else None
    if isinstance(details, list):
        for detail in details:
            if not isinstance(detail, dict) or str(detail.get("@type", "")).rsplit("/", 1)[-1] != "google.rpc.RetryInfo":
                continue
            delay = parse_reset_duration(detail.get("retryDelay"))
            if delay is not None:
                delays.append(delay)
    for budget in ("requests", "tokens"):
        remaining = _nonnegative_number(normalized.get(f"x-ratelimit-remaining-{budget}"))
        if remaining != 0:
            continue
        delay = parse_reset_duration(normalized.get(f"x-ratelimit-reset-{budget}"))
        if delay is not None:
            delays.append(delay)
    return max(delays) if delays else None


def model_scoped_quota(provider, body):
    """Recognize model-scoped 429s from provider fields, without logging the response."""
    if not isinstance(body, dict):
        return False
    error = body.get("error")
    if not isinstance(error, dict):
        choices = body.get("choices")
        choice = choices[0] if isinstance(choices, list) and choices else None
        error = choice.get("error") if isinstance(choice, dict) else None
    if not isinstance(error, dict):
        return False

    if provider == "groq":
        # Groq reports model token/request quotas as rate_limit_exceeded.
        # Leave unclassified organization limits shared across siblings.
        return error.get("code") == "rate_limit_exceeded" or error.get("type") == "rate_limit_exceeded"
    if provider == "openrouter":
        metadata = error.get("metadata")
        return isinstance(metadata, dict) and metadata.get("limit_source") == "upstream_provider_shared_pool"
    if provider != "gemini":
        return False

    details = error.get("details")
    if not isinstance(details, list):
        return False
    violations = [violation for detail in details if isinstance(detail, dict)
                  and str(detail.get("@type", "")).rsplit("/", 1)[-1] == "google.rpc.QuotaFailure"
                  and isinstance(detail.get("violations"), list) for violation in detail["violations"]]
    # A single project-wide violation is enough to keep the shared cooldown.
    return bool(violations) and all(
        isinstance(violation, dict) and isinstance(violation.get("quotaDimensions"), dict)
        and bool(violation["quotaDimensions"].get("model"))
        for violation in violations
    )


def embedded_provider_error(body):
    """Return safe (HTTP status, code, field) from an HTTP-200 error envelope.

    OpenAI-compatible providers can fail after beginning output and return an
    error object at the top level or on the first choice. Only an explicit
    400--599 numeric error code qualifies; normal completion fields and error
    messages never supply a guessed status. Partial output stays available in
    the original body for the caller's existing validation and salvage path.
    """
    if not isinstance(body, dict):
        return None
    errors = [body.get("error")]
    choices = body.get("choices")
    if isinstance(choices, list) and choices and isinstance(choices[0], dict):
        errors.append(choices[0].get("error"))
    for error in errors:
        if not isinstance(error, dict):
            continue
        raw_status = error.get("code")
        status = _nonnegative_number(raw_status)
        if status is None or not status.is_integer() or not 400 <= status <= 599:
            continue
        code = str(raw_status)[:80]
        field = error.get("param")
        return int(status), code, field[:120] if isinstance(field, str) else None
    return None
