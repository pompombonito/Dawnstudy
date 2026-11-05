# Optional reading services and additional providers

Reviewed on November 5, 2026 against the linked official documentation. The community [Free-LLM directory](https://github.com/nejib1/Free-LLM#provider-directory) is a discovery list; it mixes renewable free allowances, evaluation access, promotions, and one-time credits.

## SMRY

Create a key in the [SMRY developer console](https://smry.ai/mcp-api-cli?view=keys), then set `SMRY_API_KEY` in **Render → Dawnstudy API service → Environment**. Do not put it in a `NEXT_PUBLIC_` variable, commit it, or paste it into a chat. Locally, set it in the backend process environment.

Dawnstudy uses the documented `POST https://api.smry.ai/v1/articles/extract` as an optional fallback when a publicly accessible webpage returns too little initial HTML text. It reads extracted source text, not a summary. A missing key leaves the existing reader in place; a timeout, quota error, malformed response, or incomplete extraction does not produce invented material. Login walls remain rejected. The integration never saves an article to the owner's SMRY library.

SMRY is a reading service, not an additional quiz-generation model. Its [API contract](https://api.smry.ai/openapi.json) also supports saved library text and original-file uploads. The [library guide](https://smry.ai/docs/guides/library.md) documents a 25 MB cap for files parsed as text, including PDFs. It does not document source page coordinates, highlight-answer preservation, or extracted figure associations, so Dawnstudy keeps its own PDF/questionnaire pipeline for those tasks. This integration does not send uploaded student files to SMRY or claim to fix PDF OCR through it. Private library lookup is not exposed through the app owner's shared key.

SMRY [Free access](https://smry.ai/pricing) includes personal API access; actual account quotas are available through `GET /v1/me`. The key has not been live-tested until it is configured on Render.

## Additional providers worth obtaining keys for

These services are **not wired into the current generation fallback pool**. Dawnstudy currently supports Groq, Gemini, Z.ai, Mistral, and OpenRouter. Get keys only for the providers you intend to add; extra keys for the same account do not create extra quota.

| Provider | Useful for | Official key page | Free access and practical limits |
| --- | --- | --- | --- |
| Cloudflare Workers AI | A separate generation/vision fallback; Gemma 4 26B A4B IT is available with image input | [Workers AI dashboard](https://dash.cloudflare.com/?to=/:account/ai/workers-ai): Use REST API → Create a Workers AI API Token; also copy Account ID | [10,000 neurons/day](https://developers.cloudflare.com/workers-ai/platform/pricing/), a compute allowance rather than a fixed question count. Some frontier models require billing; use models eligible for Workers Free. [Gemma model documentation](https://developers.cloudflare.com/workers-ai/models/gemma-4-26b-a4b-it/). |
| OpenTyphoon | An additional PDF/image OCR candidate, with text and figure descriptions | [OpenTyphoon](https://opentyphoon.ai/) → sign up → API key | [Typhoon OCR](https://docs.opentyphoon.ai/en/ocr/) accepts PNG/JPEG/PDF; [20 requests/minute](https://docs.opentyphoon.ai/en/rate-limits/). The [FAQ](https://docs.opentyphoon.ai/en/faq/) describes free research-showcase access, not guaranteed production capacity. Figure descriptions still require source-layout binding. |
| Vercel AI Gateway | Another route to supported generation and vision models | [AI Gateway API keys](https://vercel.com/dashboard/ai-gateway/api-keys) | [Free tier includes $5/month](https://vercel.com/docs/ai-gateway/pricing); paid credits change the account tier. A small shared allowance, not unlimited free models. Check the dashboard's eligible models and any account verification requirements before depending on it. |

NVIDIA NIM's hosted free access is documented for [prototyping/research/testing](https://docs.api.nvidia.com/nim/docs/product), so it is not presented as free capacity for current real students. Cohere distinguishes [free evaluation keys from production keys](https://docs.cohere.com/docs/going-live); its trial tier is not a substitute for production capacity. One-time trial credits and unverified third-party relays are not included in the recommended production fallback list.
