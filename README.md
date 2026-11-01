# Dawnstudy

A student study desk that turns uploaded notes into flashcards, multiple-choice questions, select-all-that-apply questions, or identification prompts. Access currently requires a verified Google account ending in `@ceu.edu.ph`, `@mnl.ceu.edu.ph`, `@mkt.ceu.edu.ph`, or `@mls.ceu.edu.ph`, with one owner account exception. The interface is a Next.js app for Vercel; the Python API runs on Render and can use Groq, Gemini, Mistral, and OpenRouter's free-model router. The selected model is tried first and other configured models can help finish a partial response. Optional web enrichment uses Tavily Search and returns source links alongside the study set.

## Run locally

1. Install Node.js 20 or newer. In the project root, run `npm install` and `npm run dev`.
2. In `backend`, create a Python 3.11+ virtual environment, install `requirements.txt`, and start the API with `uvicorn main:app --reload --port 8000`.
3. Add at least one server-side AI provider key (`GROQ_API_KEY`, `GEMINI_API_KEY`, `MISTRAL_API_KEY`, or `OPENROUTER_API_KEY`). Auto mode chooses a model tier based on the upload, extracted text, and question count. It and manual selection can fall back across configured models if a model returns a rate-limit, service error, or incomplete response. Authorized students may generate up to 100 items in each format, with no Dawnstudy daily generation cap.
4. To enable the web-enrichment switch and PDF Finder, set `TAVILY_API_KEY` on the API. Without a key, web search features explain that the API is not configured.

Supported materials are PDF, PowerPoint (`.pptx`), DOCX, TXT, Markdown, and PNG/JPG/JPEG/WEBP images up to 15 MB. Students can upload those files or paste a public webpage URL; pages that require sign-in or block public access return a clear access error. Direct links to supported file types can also be pasted. PowerPoint slides and PDF pages are labeled so generated cards can cite slide/page references. Uploaded images are OCR-processed with the bundled Tesseract engine and English language data before being sent to the selected AI model. The API truncates extracted content to a bounded context window before sending it to the model.

Page/slide selection accepts a blank field, `All pages`, `All slides`, `all`, or `*` for the whole document, ignoring capitalization and extra spacing. Numbered selections support inputs such as `1-5, 8`, `pages 1 to 5; 8`, Unicode dashes, and line-separated lists. Duplicate page numbers are combined, and trailing separators are tolerated. Invalid, reversed or out-of-bounds ranges still return a clear error rather than selecting unexpected material. The same parser handles uploads, direct document links and saved selections reused for continuation.

Question generation runs as an account-scoped background job that can be recovered after a refresh. **Cancel generation** stops queued work immediately and requests cooperative cancellation of running work. A provider request already in flight can finish first; no further batches or saves begin after cancellation is acknowledged. The final save is protected once it starts. Cancelling preserves the selected materials and any existing study set being continued.

Profiles offer 195 icons, including **80 anime chibis across 16 series**. Choose **Anime** in the profile icon picker or in **Customize companion**; filter by series or search by character name. All 80 also work as companions. The roster includes five characters from *The Fragrant Flower Blooms with Dignity*. Eyes, mouths, hair, and headwear have subtle, staggered motion; hidden/offscreen characters pause and reduced-motion preferences are respected. Occasional bubbles alternate original study encouragement with verified short signature lines where available, every 150 seconds while the page is visible and the dock is closed. Quiet mode pauses bubbles. The [character roster and references](docs/anime-companions.md) distinguish quoted dialogue from original study encouragement.

## Deploy

### API on Render

Create a Render web service from this repository using `render.yaml` (or configure the service with root directory `backend`, build command `pip install -r requirements.txt`, and start command `uvicorn main:app --host 0.0.0.0 --port $PORT`). OCR engine and English language data are installed as Python wheels, so the build does not need system package installation. Set one or more AI provider keys and set `FRONTEND_ORIGINS` to the exact Vercel site origin. Add `TAVILY_API_KEY` to enable web enrichment and PDF Finder.

**Model hosting:** Vercel hosts the frontend, Render hosts the API, and configured model providers run their hosted APIs. Render's compute plans provide CPU and RAM; neither service needs to load model weights for this architecture. Provider API keys stay on Render and are never sent to the browser. Configure `AI_MODEL_ORDER` to set model order; models added by Dawnstudy remain available even if Render has an older order value. Auto mode selects a compact, balanced, or larger-context model based on upload size, extracted text length, and requested question count. Auto and manual modes can try every configured model if a model returns a rate-limit, service error, invalid response, or incomplete response; complete questions from a partial response are retained and duplicates are skipped. Groq's supported models use strict JSON Schema output, and OpenRouter only routes requests to endpoints that honor the requested JSON format. OpenRouter adds free Qwen 3.8 and Gemma 4 choices; additional Mistral choices are available through the existing Mistral key and may be subject to that account's pricing and limits. Each provider request times out after 60 seconds. Dawnstudy cannot read shared live provider quota meters, and generation can stop if all tried models are rate-limited or unavailable.

**Generation size and availability:** Each request accepts 1–100 questions; the UI offers 10 through 100 in steps of 10. All eligible signed-in accounts have no Dawnstudy daily generation cap. Generation no longer reserves or refunds daily usage counters; historical `AIUsage` rows are retained. AI providers still enforce their own quotas, and the active-job/queue protections remain in place. Partial results are saved and can be continued toward the original target.

**Larger saved sets:** The API automatically extends `StudySets` with `items_json_2` through `items_json_10` and splits longer question JSON across cells within the existing per-cell size budget. Reads join the fragments before decoding JSON. Older single-cell sets remain readable, and updates clear unused fragments. Source-link and page-scope metadata retain their existing fields. No new credentials or manual data migration are needed.

### $0 prototype setup

The repository is configured for Render's Free web service plan. Vercel Hobby is free for personal, non-commercial projects. Groq, Gemini, Mistral, OpenRouter, and Tavily each have provider-specific plans and limits that can change; check the provider dashboards before relying on them. To keep this at $0, use only free access and do not attach billing or upgrade plans. If all configured AI provider quotas are exhausted, generation will stop until a quota resets. Web enrichment still requires a separate `TAVILY_API_KEY` and its quota is independent.

Free services have limits: Render spins down after 15 minutes without traffic, and the next request can take about a minute to wake it. Render's free filesystem is temporary, which is okay here because uploaded study files are processed in memory and Dawnstudy does not save them. Vercel Hobby is restricted to personal, non-commercial use. OpenRouter's free plan currently allows 50 requests/day in total; free models can have low shared rate limits, so this router is a backup pool and not reserved capacity for each student.

**Uploaded material and privacy:** Uploaded files are processed in memory and are not stored. Generated study sets are stored in the configured Google Sheet for authorized accounts. Review the selected AI provider's data-use terms before uploading class notes; provider terms and free-tier data handling differ.

### Google sign-in and Sheets storage

Access requires Google sign-in through a Google Cloud OAuth client and a configured Google Sheet. Username/password and guest access are not available. Sign-in accepts verified Google accounts ending in `@ceu.edu.ph`, `@mnl.ceu.edu.ph`, `@mkt.ceu.edu.ph`, or `@mls.ceu.edu.ph`, plus the developer's `daquioagjairo30@gmail.com` account.

1. In Google Cloud Console, create/select a project and enable the **Google Sheets API**.
2. Create a Google spreadsheet. The API creates the `Users`, `StudySets`, `AIUsage`, `CardProgress`, `ReviewLogs`, `StudyShares`, and `CardReports` tabs and their header rows automatically on first account or generation use.
3. Create a service account, make a JSON key, and share the spreadsheet with the service account's `client_email` as an Editor. Keep the JSON key private.
4. Configure the Google Auth Platform consent screen and create an OAuth **Web application** client. Add `https://dawnstudy.vercel.app` to Authorized JavaScript origins (add `http://localhost:3000` for local development). No redirect URI is needed for Google Identity Services.
5. Add these Render environment variables, then redeploy the API:
   - `GOOGLE_CLIENT_ID`: OAuth web client ID.
   - `GOOGLE_SERVICE_ACCOUNT_JSON`: complete service-account JSON key contents.
   - `GOOGLE_SHEETS_SPREADSHEET_ID`: the ID between `/d/` and `/edit` in the spreadsheet URL.
   - `SESSION_SECRET`: a private random string of at least 32 characters.
6. Add `NEXT_PUBLIC_GOOGLE_CLIENT_ID` to Vercel with the same OAuth client ID, then redeploy the frontend.

Google Sheets is intended for a small, low-traffic prototype here. It stores account profile fields, historical usage records, and generated study-set JSON. Keep the spreadsheet private and share it only with the service account and trusted administrators. Google verifies the account email; the backend enforces the domain allowlist on sign-in and every protected API request.

The Sheets API's standard usage is available at no additional cost, within its quotas. Do not attach a billing account for this $0 prototype; keep use low and below quotas. Shared study links are public to anyone who has the unguessable link and can be revoked by the owner. Card reports are recorded in `CardReports` for the project owner to review. See [Google Sheets API usage limits and pricing](https://developers.google.com/workspace/sheets/api/limits).

### Frontend on Vercel

Import the repository into Vercel and deploy the Next.js project from the repository root. Set `NEXT_PUBLIC_API_URL` to the Render API base URL (without a trailing slash), for example `https://dawnstudy-api.onrender.com`. `render.yaml` sets the API service's `FRONTEND_ORIGINS` manually, so enter the deployed Vercel origin there, for example `https://your-project.vercel.app` (add a comma-separated preview origin if needed). Redeploy the API after changing its environment.

### Keep the API awake

The keep-alive program requests the public homepage and sends `GET /api/health` directly to Render every five minutes. Both checks start independently, so homepage failures cannot prevent Render traffic. It validates homepage HTML and API JSON `status: "ok"`, allows 90 seconds for a cold start, and retries each failed target up to three times with ten seconds between attempts. It logs results and continues after outages. These checks do not sign in, generate study sets, call model providers, or use Google Sheets. API health checks the process, not those dependencies.

**Run independently of your computer:** The workflow is published on this repository's default branch. In GitHub **Actions → Keep Dawnstudy API awake**, select **Run workflow** for an immediate check. The schedule requests checks every five minutes and marks a run failed if either target exhausts retries. It needs no API keys or npm install. For another deployment, set the repository's **Settings → Secrets and variables → Actions → Variables**: `KEEP_ALIVE_API_URL` is the API base URL (without `/api/health`), and `KEEP_ALIVE_SITE_URL` is the homepage URL. Forks skip checks unless both variables are set.

**Run on an always-on computer or server:** With Node.js 22+ installed, use `npm run keep-alive`; stop with Ctrl+C. `npm run keep-alive:check` makes one check with retries and exits with code 1 on failure. A sleeping, disconnected, or switched-off computer cannot send checks. Run outside the Render API process, because an in-process timer stops when Render sleeps. To change the target in PowerShell:

```powershell
$env:KEEP_ALIVE_API_URL = "https://your-api.onrender.com"
npm run keep-alive
```

Optional environment variables are `KEEP_ALIVE_SITE_URL` (defaults to the production homepage), `KEEP_ALIVE_INTERVAL_SECONDS` (default 300, range 60–600) and `KEEP_ALIVE_TIMEOUT_SECONDS` (default 90, range 1–120). Set these in the launching shell or process manager; the script does not load `.env` files. Test the monitor with `npm run test:keep-alive`.

This reduces idle sleeping; it cannot guarantee zero downtime or recover a suspended/crashed host. [GitHub schedules can be delayed or dropped](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule), and public-repository schedules disable after 60 days without repository activity. Check that the workflow remains enabled; use a dedicated external monitor or an always-on host when tighter availability is required. GitHub Actions usage depends on repository visibility and account allowance, so check your Actions usage before enabling a frequent schedule in a private repository. [Render Free limits](https://render.com/docs/free) still apply: 750 running hours are shared by all free services in a workspace each month, exhausted hours suspend services, and Render can restart a free service at any time. Continuous activity uses those hours. A paid Render compute instance removes idle spin-down; upgrading is a separate hosting decision.

### Capacity testing

Review storage coalesces ratings from different students into one atomic Sheets values batch, normally within two seconds. Each request waits for durable acknowledgment; failed batches return an error. Storage-layer retries repeat the same fixed ranges, avoiding duplicate rows when a batch succeeds but its response is lost. A fresh client resubmission is a separate rating and is not deduplicated. Committed progress/history are cached together for up to 60 seconds, and each caller sees its own successful rating immediately. Study-set snapshots refresh every 30 seconds; successful saves and updates write through to loaded snapshots. Physical deletion drains pending reviews and invalidates row mappings and grid dimensions before traffic resumes.

Run **one API process and one writer per spreadsheet**. Separate workers/replicas or manual edits to the review tables can conflict with reserved row ranges; this optimization does not introduce distributed coordination. The cache reloads existing history after a restart, and successful ratings are already on Sheets. API/provider failures and hosting limits still apply.

The [25-student validation report](docs/capacity-25-2026-11-01.md) records 745 API requests and 300 persisted ratings with no errors or quota rejections in a 130-second isolated mixed-use test. With backend Python dependencies plus `httpx`, repeat it using `python scripts/stress-test-mixed.py --capacity-25 --output docs/capacity-25-repeat.json`. This runs real local routes with synthetic students, simulated Sheets/AI responses, and blocked external traffic; it does not establish a production user maximum.

Run `npm run stress-test -- --output docs/load-test-repeat.json` for a bounded public-traffic baseline; `npm run test:stress-test` tests that harness. It exercises public HTML, API health, and model listing with automatic overload stops. The [earlier baseline report](docs/performance-2026-11-01.md) preserves the measurements before the storage optimization. `python scripts/audit-study-capacity.py` verifies the current review storage-operation counts and generation queue boundaries without external requests or credentials.

## API

Profiles, classic and character themes with light/dark modes, companion chat, friends, encrypted direct messages, live quizzes, YouTube materials and the agreement flow are documented in [Community features and operations](docs/community.md), including setup, encryption boundaries and regression checks. Classic palettes are Classic, Ocean, Forest and Sepia; character themes are Cinnamoroll, Pompompurin, Kuromi and Hello Kitty. Kuromi dark is the default before sign-in.

- `GET /api/health` reports API availability and the configured model fallback order; `GET /api/models` lists choices for manual selection.
- `POST /api/material-search` searches for relevant learning resources using a topic, subject, book/article title, or tags. Results identify direct links to supported file formats when possible. It requires the same Tavily key as web enrichment and a bearer session token from an allowed Google account.
- `POST /api/generate` accepts either a multipart `file` or public `source_url`, plus `format` (`flashcards`, `multiple_choice`, `checkbox`, `identification`), `use_web` (`true`/`false`), `model` (`auto` or a configured model ID), and optional `question_count` (1–100). It requires a bearer session token from an allowed Google account.

Uploaded file contents are held in memory for extraction and generation. `POST /api/auth/google` verifies and allowlists Google sign-in, `GET /api/auth/me` returns the signed-in profile, and `GET/POST/DELETE /api/study-sets` list, save, and delete the signed-in user's study sets. `POST /api/study-sets/{id}/share`, `DELETE /api/study-sets/{id}/share`, and `GET /api/shared/{token}` create, revoke, and read tokenized share links. `POST /api/reports` lets signed-in students report a card. `GET /api/reviews/due`, `POST /api/reviews`, and `GET /api/progress` provide due cards, Anki-style Again/Hard/Good/Easy scheduling, and review/streak statistics. Study schedules and review history are stored in the `CardProgress` and `ReviewLogs` tabs; reports and share links are stored in their corresponding tabs. Generation and account endpoints require the bearer token returned by sign-in.
