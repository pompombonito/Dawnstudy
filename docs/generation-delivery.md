# Generation delivery and recovery

Updated November 9, 2026. The website submits account-scoped background jobs through `/api/generation-jobs`. An accepted, supported request stays pending through temporary provider, network, and storage failures; recovery preserves verified work and resumes the same request. The changes use existing hosting, browser storage, and configured providers, with no added paid services or provider calls during validation.

## Why generation used to stop

- Notes generation allowed only two provider rate-limit resets and accepted retry delays of at most 60 seconds. A third normal quota reset, or a longer reset, could disable the provider for the rest of a large set.
- A malformed response could ban a model across later source pages. Questionnaire completion used large fixed batches and could leave a recoverable omission unresolved after trying each provider.
- Overall generation and browser-monitoring deadlines could turn slow progress into a partial result or disconnected observer.
- Jobs and uploaded files existed only in the API process. A Render restart removed them; remembering a job ID alone could not reconstruct the request.
- A hung status request had no individual deadline. An accepted submission followed by a gateway error or unreadable response could appear to fail, encouraging duplicate submissions.
- Numeric-only retry parsing missed HTTP-date and Google RetryInfo hints. OpenRouter's documented errors inside HTTP 200 responses could be mistaken for malformed output.

## What happens now

1. **Retain the request before submission.** The browser assigns a stable UUID and keeps the original form fields, file names/bytes, and any continuation base in IndexedDB, scoped by account. Progress observations await checkpoint persistence before the next poll.
2. **Validate and checkpoint progress.** Notes retain unique questions that pass source, answer, and option checks. Questionnaire imports preserve supplied answers and original item identity, fill only eligible missing information, and split incomplete batches into smaller groups. Bad output for one source section does not ban a healthy model for later sections.
3. **Wait without occupying a worker.** Temporary rate limits and transport failures try available alternatives. When capacity is unavailable, the API keeps the checkpoint, marks the job queued/waiting, and schedules its next pass. A timer releases the generation worker during the cooldown. Background generation has no overall elapsed completion deadline; direct `/api/generate` requests still have bounded request budgets.
4. **Recover the same operation.** Status and submission requests have individual timeouts. Lost submission responses discover accepted work before any replay. Browser monitoring continues through transient failures, automatically reconnects, and checks the known job ID. If the API restarted and confirms the job is missing, the browser replays its retained sources, checkpoint, and request UUID. Request validation binds checkpoint scope to the original material, format, page selection, and image setting.
5. **Sync using stable identity.** New study sets reuse the request UUID; card IDs survive checkpoint recovery. If a save succeeded before its response was lost, the API can discover the saved result instead of generating another set. Temporary Sheets failures retain the completed checkpoint for another sync attempt. Continuing a saved set retains that set's ID and existing card identities.

Cancellation remains available during queued cooldowns and requests cooperative cancellation during work. A pending cancellation survives refresh and prevents replay after an API restart. Saving is fenced once it begins.

## Supported input and recovery boundaries

Temporary infrastructure failure means **waiting and automatic retry**, not successful completion with a reduced target. Unreadable pages, conflicting keys, unsupported layouts, or genuinely ambiguous questions need corrected source material. In a questionnaire, verified items are preserved and unresolved question numbers are reported; the system does not guess answers to fill the count.

API job state and retry timers remain in one process. Browser recovery requires reopening the same browser/account with its IndexedDB record intact; it cannot resume on a different device or after that data is removed. Progress since the last observed checkpoint may need to be regenerated after a crash. Browser storage can be unavailable or evicted. Original uploads are not saved to server disk; the local recovery copy remains until successful sync, confirmed cancellation, or a terminal request error. Keep this privacy change visible when handling student documents.

Admission limits still bound retained upload memory and concurrent jobs. Free hosts can restart or suspend, and provider quotas and model access remain external constraints. The application can preserve and retry an accepted request; it cannot create upstream capacity, restore invalid credentials, or promise an absolute completion time or uninterrupted uptime.

## Offline verification

With backend requirements plus `httpx` and the project's Node dependencies installed, run from the repository root:

```text
python -m unittest discover -s backend -p "test_*.py"
node --test tests/generation-jobs.test.mjs
npm run build
```

The backend delivery tests simulate repeated long cooldowns, 200-question sets in all four notes formats, restart from a checkpoint, stable IDs, save-response loss, sync-only retry, and cancellation. Provider metadata and questionnaire tests use synthetic responses and clocks. No test here establishes production quota availability or consumes live inference credits.

`tests/generation-recovery-browser.mjs` additionally exercises real IndexedDB, refresh/restart replay, account separation, stale observers, and cancellation with mocked API traffic. Run a local frontend on port 3044 with `NEXT_PUBLIC_API_URL=http://localhost:8000`, then run `node tests/generation-recovery-browser.mjs`. The harness requires Playwright Core and Edge; `DAWNSTUDY_PLAYWRIGHT_PATH`, `DAWNSTUDY_BROWSER`, and `DAWNSTUDY_TEST_URL` allow existing local alternatives. It makes no live AI or Sheets requests.

## Research used

- [HTTP Semantics: Retry-After](https://www.rfc-editor.org/rfc/rfc9110.html#name-retry-after) permits seconds or an HTTP date. Recovery accepts both and rejects negative or nonfinite values.
- [Groq rate limits](https://console.groq.com/docs/rate-limits) distinguish daily request resets from minute token resets. Reset headers are used only when their corresponding remaining budget is exhausted.
- [Google RetryInfo](https://docs.cloud.google.com/php/docs/reference/common-protos/latest/Rpc.RetryInfo) describes a minimum delay and recommends backoff. A retry hint does not guarantee that a daily quota has reset.
- [OpenRouter's response handling guidance](https://openrouter.ai/blog/tutorials/model-routing-for-support-bots-cheap-first-faq-handling/) documents top-level and choice-level errors inside HTTP 200 responses. These are classified using their explicit numeric error status while retaining verifiable partial output.
- [Render Free service limits](https://render.com/docs/free) explain process restarts and temporary local storage, motivating browser-held recovery rather than a claim that process memory is durable.
