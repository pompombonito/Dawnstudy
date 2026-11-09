"""Recover questionnaire completion without changing source answers or guessing.

Transport failures and malformed JSON are temporary response failures. Valid
but uncertain or contradictory answers are source/validation failures: try
another model and smaller batches, then report the unresolved records instead
of endlessly re-solving an ambiguous question.
The caller owns provider I/O and answer validation.
"""

import math
import time
from collections import defaultdict, deque


def complete_questionnaire_batches(records, models, attempt, eligible, *,
                                   durable=False, timeout=1200,
                                   cancelled=lambda: None,
                                   progress=lambda *_args: None,
                                   checkpoint=lambda *_args: None,
                                   defer=None,
                                   clock=None, sleep=None):
    """Return verified completions, used models, and the last safe error.

``attempt(choice, records)`` returns ``(verified_by_number, invalid_by_number,
provider_error)``. It must apply the questionnaire's authoritative-answer and
uncertainty checks before calling anything verified. Completed numbers are never
submitted again. ``eligible`` prevents text-only models receiving questions
that require pixels. Durable workers wait through transient outages until
cancellation; ordinary direct calls retain a finite request budget.
    """
    clock = clock or time.monotonic
    sleep = sleep or time.sleep
    deadline = None if durable else clock() + timeout
    completions, used_models = {}, []
    cooldowns, consecutive = {}, defaultdict(int)
    disabled_providers, disabled_models = set(), set()
    direct_retries = defaultdict(int)
    last_error = "AI providers are temporarily unavailable. Try again shortly."
    last_status = 503

    def expired():
        return deadline is not None and clock() >= deadline

    def remaining_records(batch):
        return [record for record in batch if record["number"] not in completions]

    def publish(verified, choice):
        if not verified:
            return
        completions.update(verified)
        if choice[0] not in used_models:
            used_models.append(choice[0])
        checkpoint(dict(completions), list(used_models))
        progress("verified", len(completions), choice[4])

    for offset in range(0, len(records), 8):
        work = deque([records[offset:offset + 8]])
        while work:
            cancelled()
            if expired():
                return completions, used_models, "Questionnaire completion timed out. Try again when a provider is available.", 503
            batch = remaining_records(work.popleft())
            initial_batch_size = len(batch)
            quality_attempted = set()
            output_retries = {}
            while batch:
                cancelled()
                if expired():
                    return completions, used_models, "Questionnaire completion timed out. Try again when a provider is available.", 503
                waiting = []
                choice_to_try = None
                for choice in models:
                    model_id, provider, model = choice[:3]
                    if (provider in disabled_providers or model_id in disabled_models
                            or model_id in quality_attempted or not eligible(batch, choice)):
                        continue
                    reset_at = cooldowns.get(provider, 0)
                    if reset_at > clock():
                        waiting.append((reset_at, choice))
                        continue
                    choice_to_try = choice
                    break

                if choice_to_try is None:
                    # A large malformed response or omission need not mean the
                    # underlying questions cannot be answered. Retry smaller
                    # groups, preserving all already verified completions.
                    if quality_attempted and (len(batch) > 1 or len(batch) < initial_batch_size):
                        if len(batch) == 1:
                            work.appendleft(batch)
                        else:
                            midpoint = (len(batch) + 1) // 2
                            work.appendleft(batch[midpoint:])
                            work.appendleft(batch[:midpoint])
                        break
                    if durable:
                        waiting.extend((reset_at, choice) for reset_at, choice in output_retries.values()
                                       if eligible(batch, choice))
                    if waiting:
                        wait_until, waiting_choice = min(waiting, key=lambda pair: pair[0])
                        progress("waiting", len(completions), waiting_choice[4])
                        if durable and defer is not None:
                            cancelled()
                            # The owner checkpoints verified items before this
                            # call. Its deferral releases the worker and later
                            # resumes the same account-scoped job.
                            defer(max(1, wait_until - clock()))
                        while clock() < wait_until and not expired():
                            cancelled()
                            sleep(max(0, min(.5, wait_until - clock(),
                                             deadline - clock() if deadline is not None else .5)))
                        for retry_id, (reset_at, _choice) in list(output_retries.items()):
                            if reset_at <= clock():
                                quality_attempted.discard(retry_id)
                                output_retries.pop(retry_id)
                        continue
                    # Every capable model returned an unusable/uncertain
                    # answer, or has a permanent configuration error. Keep
                    # explicit unresolved records for the final notices.
                    break

                choice = choice_to_try
                model_id, provider, model = choice[:3]
                subset = eligible(batch, choice)
                progress("generating", len(completions), choice[4])
                verified, invalid, error = attempt(choice, subset)
                cancelled()
                publish(verified, choice)
                batch = remaining_records(batch)
                if error is None:
                    consecutive[provider] = 0
                    # A syntactically valid response may still omit a record
                    # or mark it uncertain. Do not repeat it indefinitely.
                    quality_attempted.add(model_id)
                    if invalid:
                        last_error = next(iter(invalid.values()))
                        last_status = 422
                    elif batch:
                        last_error = "Some questionnaire answers could not be verified from the supplied source."
                        last_status = 422
                    continue

                status = getattr(error, "status", None)
                error_code = getattr(error, "error_code", None)
                malformed_output = (status == 200 or
                                    (status in {400, 422} and error_code == "json_validate_failed"))
                retryable = (status == 429 or status is None
                             or (isinstance(status, int) and status >= 500))
                if retryable:
                    last_error = "AI providers are temporarily unavailable. Your verified questions are kept."
                    last_status = 429 if status == 429 else 503
                    direct_retries[provider] += 1
                    if not durable and direct_retries[provider] > 2:
                        disabled_providers.add(provider)
                        continue
                    consecutive[provider] += 1
                    delay = getattr(error, "retry_after", None)
                    if (not isinstance(delay, (int, float)) or not math.isfinite(delay)
                            or delay < 0):
                        delay = min(60, 5 * (2 ** min(consecutive[provider] - 1, 4)))
                    cooldowns[provider] = clock() + max(1, delay)
                elif status in {401, 403}:
                    # Gemini 2.5 access denials can be specific to the model.
                    # Trying a newer model uses the same configured account.
                    if provider == "gemini" and model in {"gemini-2.5-flash-lite", "gemini-2.5-flash"}:
                        disabled_models.add(model_id)
                    else:
                        disabled_providers.add(provider)
                    last_error = "A configured AI provider could not authorize this request."
                    last_status = 503
                elif status == 404:
                    disabled_models.add(model_id)
                    last_error = "A configured AI model is unavailable."
                    last_status = 503
                elif malformed_output:
                    # Reduce large malformed responses before waiting. A
                    # one-question JSON failure is still a provider response
                    # failure, rather than evidence of an ambiguous answer.
                    # Keep the model eligible for a paced durable retry.
                    quality_attempted.add(model_id)
                    if durable:
                        output_retries[model_id] = (clock() + 5, choice)
                    last_error = "An AI response could not be read. Your verified questions are kept."
                    last_status = 503
                else:
                    # Other request/validation failures are local to this
                    # batch, not an outage that should ban later source work.
                    quality_attempted.add(model_id)
                    last_error = (next(iter(invalid.values())) if invalid
                                  else "Some questionnaire answers could not be verified from the supplied source.")
                    last_status = 422

    return completions, used_models, last_error, last_status
