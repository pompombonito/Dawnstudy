# Dawnstudy

A student study desk that turns uploaded notes into flashcards, multiple-choice questions, select-all-that-apply questions, or identification prompts. Access currently requires a verified Google account ending in `@ceu.edu.ph`, with one owner account exception. The interface is a Next.js app for Vercel; the Python API runs on Render and can use Groq, Gemini, Mistral, and OpenRouter's free-model router. The selected model is tried first and other configured models can help finish a partial response. Optional web enrichment uses Tavily Search and returns source links alongside the study set.

## Run locally

1. Install Node.js 20 or newer. In the project root, run `npm install` and `npm run dev`.
2. In `backend`, create a Python 3.11+ virtual environment, install `requirements.txt`, and start the API with `uvicorn main:app --reload --port 8000`.
3. Add at least one server-side AI provider key (`GROQ_API_KEY`, `GEMINI_API_KEY`, `MISTRAL_API_KEY`, or `OPENROUTER_API_KEY`). Auto mode chooses a model tier based on the upload, extracted text, and question count. It and manual selection can fall back across up to three models if a model returns a rate-limit, service error, or incomplete response. Authorized students may generate 10–50 items in each format.
4. To enable the web-enrichment switch, set `TAVILY_API_KEY` on the API. Without a key, web-enriched requests explain that the API is not configured.

The supported materials are text-based PDF, DOCX, TXT, and Markdown files up to 15 MB. Scanned PDFs need OCR before upload. The API truncates extracted content to a bounded context window before sending it to the model.

## Deploy

### API on Render

Create a Render web service from this repository using `render.yaml` (or configure the service with root directory `backend`, build command `pip install -r requirements.txt`, and start command `uvicorn main:app --host 0.0.0.0 --port $PORT`). Set one or more AI provider keys and set `FRONTEND_ORIGINS` to the exact Vercel site origin. Add `TAVILY_API_KEY` to enable web search.

**Model hosting:** Vercel hosts the frontend, Render hosts the API, and configured model providers run their hosted APIs. Render's compute plans provide CPU and RAM; neither service needs to load model weights for this architecture. Provider API keys stay on Render and are never sent to the browser. Configure `AI_MODEL_ORDER` to set model order. Auto mode selects a compact, balanced, or larger-context model based on upload size, extracted text length, and requested question count. Auto and manual modes can try up to three configured models per generation, preferring different providers for fallback; complete questions from a partial response are retained and duplicates are skipped. Each provider request times out after 60 seconds. Dawnstudy cannot read shared live provider quota meters, and generation can stop if all tried models are rate-limited or unavailable.

**Dawnstudy limits:** Each request accepts 1–50 questions; the UI offers 10, 20, 30, 40, and 50. Authorized accounts have 5 generations per day, resetting at midnight Manila time. Counts are stored in the `AIUsage` Google Sheets tab. If Sheets storage is unavailable, counts are held in API memory and can reset when Render restarts. Provider quotas are separate and shared across everyone using the same provider key; a per-user Dawnstudy cap cannot guarantee provider availability.

### $0 prototype setup

The repository is configured for Render's Free web service plan. Vercel Hobby is free for personal, non-commercial projects. Groq, Gemini, Mistral, OpenRouter, and Tavily each have provider-specific plans and limits that can change; check the provider dashboards before relying on them. To keep this at $0, use only free access and do not attach billing or upgrade plans. If all configured AI provider quotas are exhausted, generation will stop until a quota resets. Web enrichment still requires a separate `TAVILY_API_KEY` and its quota is independent.

Free services have limits: Render spins down after 15 minutes without traffic, and the next request can take about a minute to wake it. Render's free filesystem is temporary, which is okay here because uploaded study files are processed in memory and Dawnstudy does not save them. Vercel Hobby is restricted to personal, non-commercial use. OpenRouter's free plan currently allows 50 requests/day in total; free models can have low shared rate limits, so this router is a backup pool and not reserved capacity for each student.

**Uploaded material and privacy:** Uploaded files are processed in memory and are not stored. Generated study sets are stored in the configured Google Sheet for authorized accounts. Review the selected AI provider's data-use terms before uploading class notes; provider terms and free-tier data handling differ.

### Google sign-in and Sheets storage

Access requires Google sign-in through a Google Cloud OAuth client and a configured Google Sheet. Username/password and guest access are not available. Sign-in accepts verified Google accounts ending in `@ceu.edu.ph`, plus the developer's `daquioagjairo30@gmail.com` account.

1. In Google Cloud Console, create/select a project and enable the **Google Sheets API**.
2. Create a Google spreadsheet. The API creates the `Users`, `StudySets`, `AIUsage`, `CardProgress`, and `ReviewLogs` tabs and their header rows automatically on first account or generation use.
3. Create a service account, make a JSON key, and share the spreadsheet with the service account's `client_email` as an Editor. Keep the JSON key private.
4. Configure the Google Auth Platform consent screen and create an OAuth **Web application** client. Add `https://dawnstudy.vercel.app` to Authorized JavaScript origins (add `http://localhost:3000` for local development). No redirect URI is needed for Google Identity Services.
5. Add these Render environment variables, then redeploy the API:
   - `GOOGLE_CLIENT_ID`: OAuth web client ID.
   - `GOOGLE_SERVICE_ACCOUNT_JSON`: complete service-account JSON key contents.
   - `GOOGLE_SHEETS_SPREADSHEET_ID`: the ID between `/d/` and `/edit` in the spreadsheet URL.
   - `SESSION_SECRET`: a private random string of at least 32 characters.
6. Add `NEXT_PUBLIC_GOOGLE_CLIENT_ID` to Vercel with the same OAuth client ID, then redeploy the frontend.

Google Sheets is intended for a small, low-traffic prototype here. It stores account profile fields, daily generation counts, and generated study-set JSON. Keep the spreadsheet private and share it only with the service account and trusted administrators. Google verifies the account email; the backend enforces the domain allowlist on sign-in and every protected API request.

The Sheets API's standard usage is available at no additional cost, within its quotas. Do not attach a billing account for this $0 prototype; keep use low and below quotas. See [Google Sheets API usage limits and pricing](https://developers.google.com/workspace/sheets/api/limits).

### Frontend on Vercel

Import the repository into Vercel and deploy the Next.js project from the repository root. Set `NEXT_PUBLIC_API_URL` to the Render API base URL (without a trailing slash), for example `https://dawnstudy-api.onrender.com`. `render.yaml` sets the API service's `FRONTEND_ORIGINS` manually, so enter the deployed Vercel origin there, for example `https://your-project.vercel.app` (add a comma-separated preview origin if needed). Redeploy the API after changing its environment.

## API

- `GET /api/health` reports API availability and the configured model fallback order; `GET /api/models` lists choices for manual selection.
- `POST /api/generate` accepts multipart fields `file`, `format` (`flashcards`, `multiple_choice`, `checkbox`, `identification`), `use_web` (`true`/`false`), `model` (`auto` or a configured model ID), and optional `question_count` (1–50). It requires a bearer session token from an allowed Google account.

Uploaded file contents are held in memory for extraction and generation. `POST /api/auth/google` verifies and allowlists Google sign-in, `GET /api/auth/me` returns the signed-in profile, and `GET/POST/DELETE /api/study-sets` list, save, and delete the signed-in user's study sets. `GET /api/reviews/due`, `POST /api/reviews`, and `GET /api/progress` provide due cards, Anki-style Again/Hard/Good/Easy scheduling, and review/streak statistics. Study schedules and review history are stored in the `CardProgress` and `ReviewLogs` tabs. Generation and account endpoints require the bearer token returned by sign-in.
