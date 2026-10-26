# Dawnstudy

A student study desk that turns uploaded notes into flashcards, multiple-choice questions, select-all-that-apply questions, or identification prompts. The interface is a Next.js app for Vercel; the Python API runs on Render and calls Gemini 3.8 Flash through the Gemini API. Optional web enrichment uses Tavily Search and returns source links alongside the study set.

## Run locally

1. Install Node.js 20 or newer. In the project root, run `npm install` and `npm run dev`.
2. In `backend`, create a Python 3.11+ virtual environment, install `requirements.txt`, and start the API with `uvicorn main:app --reload --port 8000`.
3. Get a Gemini API key, set `GEMINI_API_KEY` for the API, and set `GEMINI_MODEL` to `gemini-3.8-flash` (the default). Copy `.env.example` values into the frontend `.env.local` and backend environment as appropriate.
4. To enable the web-enrichment switch, set `TAVILY_API_KEY` on the API. Without a key, web-enriched requests explain that the API is not configured.

The supported materials are text-based PDF, DOCX, TXT, and Markdown files up to 15 MB. Scanned PDFs need OCR before upload. The API truncates extracted content to a bounded context window before sending it to the model.

## Deploy

### API on Render

Create a Render web service from this repository using `render.yaml` (or configure the service with root directory `backend`, build command `pip install -r requirements.txt`, and start command `uvicorn main:app --host 0.0.0.0 --port $PORT`). Set `GEMINI_API_KEY` and `FRONTEND_ORIGINS` to the exact Vercel site origin. Add `TAVILY_API_KEY` to enable web search.

**Model hosting:** Vercel hosts the frontend, Render hosts the API, and Gemini runs on Google's managed API. Render's compute plans provide CPU and RAM, while Vercel function memory is limited; neither service needs to load model weights for this architecture. The API key stays on Render and is never sent to the browser. Use a Gemini API tier that fits your privacy and search-grounding needs; review Google's current API data and pricing terms before production use.

### $0 prototype setup

The repository is configured for Render's Free web service plan. Vercel Hobby is free for personal, non-commercial projects. The Gemini API free tier currently includes free input/output tokens for supported models, and Tavily's free plan includes 1,000 search credits per month without a credit card. To keep this at $0, use those free tiers only and do not attach billing or upgrade plans. If a provider's quota runs out, generation or web search will stop until its quota resets. Confirm each provider's current plan and limits before deploying.

Free services have limits: Render spins down after 15 minutes without traffic, and the next request can take about a minute to wake it. Render's free filesystem is temporary, which is okay here because uploaded study files are processed in memory and Dawnstudy does not save them. Vercel Hobby is restricted to personal, non-commercial use.

**Uploaded material and privacy:** Uploaded files are processed in memory and are not stored. Generated study sets are stored in the user's browser for guests, or in the configured Google Sheet for signed-in users. Passwords are stored as salted PBKDF2 hashes. Gemini's free tier may use submitted content to improve Google products; do not upload confidential notes or personal information on that tier.

### Google sign-in and Sheets storage

Account features require a Google Cloud project. If account credentials are not configured, guests can still generate and keep study sets in the current browser.

1. In Google Cloud Console, create/select a project and enable the **Google Sheets API**.
2. Create a Google spreadsheet. The API creates the `Users` and `StudySets` tabs and their header rows automatically on first account use.
3. Create a service account, make a JSON key, and share the spreadsheet with the service account's `client_email` as an Editor. Keep the JSON key private.
4. Configure the Google Auth Platform consent screen and create an OAuth **Web application** client. Add `https://dawnstudy.vercel.app` to Authorized JavaScript origins (add `http://localhost:3000` for local development). No redirect URI is needed for Google Identity Services.
5. Add these Render environment variables, then redeploy the API:
   - `GOOGLE_CLIENT_ID`: OAuth web client ID.
   - `GOOGLE_SERVICE_ACCOUNT_JSON`: complete service-account JSON key contents.
   - `GOOGLE_SHEETS_SPREADSHEET_ID`: the ID between `/d/` and `/edit` in the spreadsheet URL.
   - `SESSION_SECRET`: a private random string of at least 32 characters.
6. Add `NEXT_PUBLIC_GOOGLE_CLIENT_ID` to Vercel with the same OAuth client ID, then redeploy the frontend.

Google Sheets is intended for a small, low-traffic prototype here. It stores account profile fields, password hashes, and generated study-set JSON. Keep the spreadsheet private and share it only with the service account and trusted administrators. Username/password recovery and email verification are not currently included.

The Sheets API's standard usage is available at no additional cost, within its quotas. Do not attach a billing account for this $0 prototype; keep use low and below quotas. See [Google Sheets API usage limits and pricing](https://developers.google.com/workspace/sheets/api/limits).

### Frontend on Vercel

Import the repository into Vercel and deploy the Next.js project from the repository root. Set `NEXT_PUBLIC_API_URL` to the Render API base URL (without a trailing slash), for example `https://dawnstudy-api.onrender.com`. `render.yaml` sets the API service's `FRONTEND_ORIGINS` manually, so enter the deployed Vercel origin there, for example `https://your-project.vercel.app` (add a comma-separated preview origin if needed). Redeploy the API after changing its environment.

## API

- `GET /api/health` reports API availability and configured model name.
- `POST /api/generate` accepts multipart fields `file`, `format` (`flashcards`, `multiple_choice`, `checkbox`, `identification`), and `use_web` (`true`/`false`).

Uploaded file contents are held in memory for extraction and generation. `POST /api/auth/register` and `POST /api/auth/login` create username/password accounts, `POST /api/auth/google` verifies Google sign-in, `GET /api/auth/me` returns the signed-in profile, and `GET/POST /api/study-sets` read or save the signed-in user's study sets. Account and set endpoints require the bearer token returned by sign-in.
