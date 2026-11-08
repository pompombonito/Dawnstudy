# Optional reading services and additional providers

Reviewed on November 5, 2026 against the linked official documentation. The community [Free-LLM directory](https://github.com/nejib1/Free-LLM#provider-directory) is a discovery list; it mixes renewable free allowances, evaluation access, promotions, and one-time credits.

## Local-first generation and Gemini fallback

When `OLLAMA_BASE_URL` is configured, that local Ollama model is added as the first choice even if it is not in `AI_MODEL_ORDER`. The following Gemini IDs are then ordered before other configured providers:

| Model selection ID | Availability notes |
| --- | --- |
| `gemini:gemini-2.5-flash-lite` | Listed by Google; access is restricted for some accounts |
| `gemini:gemini-2.5-flash` | Listed but deprecated/restricted; existing-user access only |
| `gemini:gemini-3.1-flash-lite` | Listed by Google |
| `gemini:gemini-3.5-flash-lite` | Listed by Google |
| `gemini:gemini-3.6-flash` | Listed by Google |
| `gemini:gemini-3.8-flash` | Listed by Google |

These are real catalog IDs in the [Gemini API model catalog](https://ai.google.dev/gemini-api/docs/models), but listing an ID in code does not grant API access. Dawnstudy skips a model-specific 403 from either Gemini 2.5 model and continues to later Gemini models. Google may change account/region availability or deprecation timelines; verify the models exposed for the production API key before relying on them.

The Antigravity entry is separate from the text-model IDs above. It uses Google's official [Antigravity managed-agent API](https://ai.google.dev/gemini-api/docs/antigravity-agent) via `antigravity:antigravity-preview-09-2026` and the existing `GEMINI_API_KEY`. The quota dashboard you shared reports 60 RPM, 100,000 TPM, and 100 RPD for this agent; the daily cap means it should be a fallback, not the primary engine for every request. This preview agent uses the Interactions API rather than OpenAI-compatible chat completions. Dawnstudy passes no `environment` and an empty tool list, so it is only asked to return the requested question JSON and isn't given web, code-execution, or filesystem tools. It has a longer per-call timeout (120 seconds).

`qwen3:4b` is the documented Dawnstudy default for Ollama. A 4B quantized model is a starting point for the RTX 3050 Ti / 16 GB laptop, not a guarantee of inference speed; keep local concurrency at one and monitor `ollama ps`/VRAM before changing it. Render cannot reach a laptop's loopback interface. Without a domain, the Windows guide describes a temporary Cloudflare Quick Tunnel through a shared-secret, loopback-only proxy (`OLLAMA_API_KEY`); its hostname rotates and it is for testing, not reliable production. A stable named Tunnel requires a domain you control and should use Cloudflare Access Service Auth. Credentials are sent only in server-side request headers, never model URLs or client code. See the [Windows setup guide](../ollama-server/README.md).

The API currently accepts six active generation jobs and runs two generation workers. The local semaphore defaults to one request; another worker that finds Ollama busy falls through to its next provider rather than waiting on a GPU queue. The maximum setting is 10 for future hardware but should not be raised on the laptop without measured headroom.

## SMRY

Create a key in the [SMRY developer console](https://smry.ai/mcp-api-cli?view=keys), then set `SMRY_API_KEY` in **Render → Dawnstudy API service → Environment**. Do not put it in a `NEXT_PUBLIC_` variable, commit it, or paste it into a chat. Locally, set it in the backend process environment.

Dawnstudy uses the documented `POST https://api.smry.ai/v1/articles/extract` as an optional fallback when a publicly accessible webpage returns too little initial HTML text. It reads extracted source text, not a summary. A missing key leaves the existing reader in place; a timeout, quota error, malformed response, or incomplete extraction does not produce invented material. Login walls remain rejected. The integration never saves an article to the owner's SMRY library.

SMRY is a reading service, not an additional quiz-generation model. Its [API contract](https://api.smry.ai/openapi.json) also supports saved library text and original-file uploads. The [library guide](https://smry.ai/docs/guides/library.md) documents a 25 MB cap for files parsed as text, including PDFs. It does not document source page coordinates, highlight-answer preservation, or extracted figure associations, so Dawnstudy keeps its own PDF/questionnaire pipeline for those tasks. This integration does not send uploaded student files to SMRY or claim to fix PDF OCR through it. Private library lookup is not exposed through the app owner's shared key.

SMRY [Free access](https://smry.ai/pricing) includes personal API access; actual account quotas are available through `GET /v1/me`. The key has not been live-tested until it is configured on Render.

## Optional additional providers

Cloudflare Workers AI, Vercel AI Gateway, and Typhoon are wired into generation alongside Groq, Gemini, Z.ai, Mistral, and OpenRouter. Their models join selection and fallback only when the corresponding server-side credentials are configured and their model IDs are added to `AI_MODEL_ORDER`. No key is sent to the browser. Extra keys belonging to one account do not create extra quota.

Set these in **Render → Dawnstudy API service → Environment**:

| Environment variable | Value |
| --- | --- |
| `SMRY_API_KEY` | Optional SMRY public article reading key |
| `CLOUDFLARE_API_TOKEN` | Token with Workers AI access |
| `CLOUDFLARE_ACCOUNT_ID` | The matching 32-character hexadecimal Account ID; this is not an API key |
| `VERCEL_AI_GATEWAY_API_KEY` | Vercel AI Gateway key; existing `AI_GATEWAY_API_KEY` is accepted when the primary name is blank |
| `TYPHOON_API_KEY` | Typhoon key for text generation and OCR recovery; existing `TYPHOON_OCR_API_KEY` is accepted when the primary name is blank |

`AI_MODEL_ORDER` is an allowlist and preference order. Only listed models with configured credentials are available for automatic selection, manual selection, or fallback, except that a configured `OLLAMA_BASE_URL` automatically prepends the chosen local model. Add a model ID to the variable to opt it in; newly supported models do not silently join an existing order. An unset or blank value uses the established model baseline, filtered to providers with credentials. No model-catalog requests occur during startup or health checks. Removing a provider key disables its models; Cloudflare requires both a valid Account ID and token.

### Generation models

| Model selection ID | Task | Access |
| --- | --- | --- |
| `ollama:qwen3:4b` | Local text generation | Self-hosted; configure `OLLAMA_BASE_URL` and keep Ollama local-only |
| `antigravity:antigravity-preview-09-2026` | Managed agent text/image generation | Gemini API key; preview agent with a separate quota bucket |
| `cloudflare:@cf/google/gemma-4-26b-a4b-it` | Text generation and labeled image inspection | Workers AI allowance; eligible for Workers Free |
| `cloudflare:@cf/nvidia/nemotron-3-120b-a12b` | Text generation | Workers AI allowance; eligible for Workers Free |
| `vercel:nvidia/nemotron-3.5-lightning-free` | Text generation | Zero token price in the verified public model catalog; provider limits and promotion availability still apply |
| `vercel:google/gemma-4-26b-a4b-it` | Text generation and labeled image inspection | Uses gateway credits |
| `vercel:openai/gpt-oss-120b` | Text generation | Uses gateway credits |
| `typhoon:typhoon-v2.5-30b-a3b-instruct` | Text generation | Free research-showcase API, subject to account limits |

The [Vercel model catalog](https://ai-gateway.vercel.sh/v1/models) confirms the exact model IDs, modalities, and current prices. Cloudflare's [Gemma model page](https://developers.cloudflare.com/workers-ai/models/gemma-4-26b-a4b-it/) documents image input; its [free-plan model announcement](https://developers.cloudflare.com/changelog/post/2026-07-28-models-require-workers-paid/) includes Gemma 4 and Nemotron 3 120B. Typhoon's [model list](https://docs.opentyphoon.ai/en/models/) distinguishes the text model from `typhoon-ocr`.

`typhoon-ocr` is an OCR recovery service, not a quiz-generation choice. Native text/highlight extraction and local OCR stay available; OCR output still goes through Dawnstudy's questionnaire parsing and source-figure binding. Typhoon's chat API does not document JSON mode, so the app supplies the field schema in the prompt and validates returned JSON. Cloudflare and Vercel use documented OpenAI-compatible chat endpoints and JSON object output. Existing answer preservation, source checks, and partial-result recovery still apply.

No live request has been verified with your new credentials until they are added to Render; contract tests use synthetic responses and consume no provider quota.

| Provider | Useful for | Official key page | Free access and practical limits |
| --- | --- | --- | --- |
| Cloudflare Workers AI | A separate generation/vision fallback; Gemma 4 26B A4B IT is available with image input | [Workers AI dashboard](https://dash.cloudflare.com/?to=/:account/ai/workers-ai): Use REST API → Create a Workers AI API Token; also copy Account ID | [10,000 neurons/day](https://developers.cloudflare.com/workers-ai/platform/pricing/), a compute allowance rather than a fixed question count. Some frontier models require billing; use models eligible for Workers Free. [Gemma model documentation](https://developers.cloudflare.com/workers-ai/models/gemma-4-26b-a4b-it/). |
| OpenTyphoon | Additional text generation and PDF/image OCR recovery | [Playground API keys](https://playground.opentyphoon.ai/settings/api-key) | [Typhoon OCR](https://docs.opentyphoon.ai/en/ocr/) accepts PNG/JPEG/PDF; [20 OCR requests/minute, 200 text requests/minute](https://docs.opentyphoon.ai/en/rate-limits/). The [FAQ](https://docs.opentyphoon.ai/en/faq/) describes free research-showcase access, not guaranteed production capacity. Figure descriptions still require source-layout binding. |
| Vercel AI Gateway | Another route to supported generation and vision models | [AI Gateway API keys](https://vercel.com/dashboard/ai-gateway/api-keys) | [Free tier includes $5/month](https://vercel.com/docs/ai-gateway/pricing); paid credits change the account tier. A small shared allowance, not unlimited free models. Check the dashboard's eligible models and any account verification requirements before depending on it. |

NVIDIA NIM's hosted free access is documented for [prototyping/research/testing](https://docs.api.nvidia.com/nim/docs/product), so it is not presented as free capacity for current real students. Cohere distinguishes [free evaluation keys from production keys](https://docs.cohere.com/docs/going-live); its trial tier is not a substitute for production capacity. One-time trial credits and unverified third-party relays are not included in the recommended production fallback list.
