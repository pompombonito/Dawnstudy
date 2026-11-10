# Generation stall and retained-progress audit

The supplied production log shows the status and health endpoints continuing to
respond while the AI providers fail to deliver usable batches. It records rejected
Gemini output, a Gemini 503, and Groq, OpenRouter and Mistral 429 responses. A status
poll returning HTTP 200 establishes that the job endpoint responded; it does not
establish that a new question was generated. The old validation messages do not
identify whether JSON syntax, output length or missing source evidence caused each
rejected batch, so the precise reason for those individual responses is unknown.

Local extraction of the supplied 127-page lecture PDF reproduces the malformed
numeric-object warnings in the log. Extraction still returns 30,583 characters
from 120 readable pages, divided into eight bounded generation windows. Seven
pages have no usable text after extraction/OCR. The warnings alone do not prove
that extraction stopped. Source files, extracted lecture text and production logs
are not included in the repository.

## Changes

- A deferred notes job retains its prepared continuation, including its current
  source window, source evidence, verified diagrams and prompt. Provider capacity
  waits no longer cause repeated PDF extraction, OCR or diagram-description calls.
  Prepared state belongs to the individual request and is released on completion
  or cancellation; no cross-account material cache was introduced.
- Provider reset deadlines and transient retry counts survive worker deferrals.
  A persistent 503 cannot continually restart its first short retry. A model's
  transient failure cools down that model, allowing a working sibling to run.
  Provider-wide quota waits still retain their own reset deadlines.
- Gemini output parsing excludes parts marked `thought`. Batch schemas now bound
  Gemini's item count as well as other providers. Gemini 3 uses low thinking;
  confirmed single-item truncation receives bounded additional output room, up to
  8,192 tokens. Empty output, invalid JSON, invalid items, missing source evidence
  and truncation receive distinct diagnostic codes. Logs contain counts and
  recognized finish reasons, without the material, prompt, response text or keys.
- The notes prompt's JSON example now includes its mandatory `source_evidence`
  field. Missing-evidence retries ask for a contiguous verbatim source quote.
  Existing evidence, figure, answer/option consistency and uniqueness validation
  continue to apply to both normal responses and recovered partial responses.
- Retry progress cannot decrease within the same job. The browser combines the
  latest API status with retained checkpoints, including after a host restart.
  Pending questionnaire explanations do not count as ready questions. Starting a
  new generation resets its counter; attaching to another job drops the previous
  job's progress.

The Gemini request and parsing changes follow Google's [thinking documentation](https://ai.google.dev/gemini-api/docs/generate-content/thinking?hl=en)
and [GenerateContent API reference](https://ai.google.dev/api/generate-content?hl=en).
Retry hints continue to follow the existing HTTP/Gemini/Groq handling; see
[Groq's rate-limit header documentation](https://console.groq.com/docs/rate-limits).

## Validation

The actual supplied PDF was processed through the real notes API, response parser,
batching, validation, checkpoint and save flow with controlled provider/storage
responses. Injected failures included malformed JSON, `MAX_TOKENS`, two Gemini
503 responses and Gemini/Groq/OpenRouter/Mistral quota responses. The run delivered
50 unique, source-grounded choice items, kept each answer consistent with its four
options, used all eight source windows, and parsed the document once. External AI
and storage requests were blocked. These fixture responses test recovery behavior;
they do not establish live model availability or the quality of live AI questions.

Automated validation passed: 471 backend tests, 203 frontend unit tests, the
production build, and browser recovery/cancellation tests. A dedicated browser regression at
1440px and 390px verifies that 18/50 remains visible through zero-count retry
updates, that progress advances to 22/50, and that a confirmed host restart replays
the original request without dropping that count. Further regressions verify
retained source-window position, diagram reuse, independently timed quota resets,
bounded truncation recovery and persistent transient retry budgets.

The background job continues waiting and retrying until verified completion or
explicit cancellation. An external provider's outage or exhausted allowance still
determines when another inference can succeed. No paid calls, subscriptions,
provider upgrades or new inference dependencies were used for this audit.
