# Dawnstudy capacity checks — November 1, 2026

**Historical baseline before review batching and committed-data caching.** Its raw measurements are preserved. The current audit script measures the optimized path; the storage counts and two-student throttling below describe the earlier code.

The live public endpoints handled the tested load without errors. This does **not** establish the maximum number of students studying, saving, and generating. Signed-in storage and AI capacity differ from public page capacity.

## Live public baseline

Tested the deployed frontend at `https://dawnstudy.vercel.app` and API at `https://dawnstudy-api.onrender.com`, from 13:35 to 13:37 Asia/Manila, using Node.js 24.22.1 on the local Windows computer. The test performed sequential homepage HTML, API health, and model-list requests per virtual visitor, then paused five seconds. Each stage lasted approximately 20 seconds. Traffic was limited to 20 request starts/second and 20 requests in flight, with a 10-second request timeout and automatic overload stops.

| Virtual visitors | Requests | Failures | Achieved requests/s | Request p95 | Test pacing wait p95 |
| ---: | ---: | ---: | ---: | ---: | ---: |
| 1 | 12 | 0 | 0.60 | 293 ms | 16 ms |
| 5 | 60 | 0 | 3.00 | 210 ms | 211 ms |
| 10 | 120 | 0 | 6.00 | 211 ms | 497 ms |
| 20 | 196 | 0 | 9.78 | 219 ms | 1,043 ms |
| 40 | 290 | 0 | 14.46 | 210 ms | 2,116 ms |

All **678 requests returned valid responses**. At the 40-visitor stage, API health p95 was 219 ms and model-list p95 was 211 ms. At most five requests were actually in flight at once in that stage; forty virtual sessions does not mean forty simultaneous HTTP requests. Request latency includes response-body consumption and validation, but excludes waiting for the test's rate/concurrency gate. The pacing wait column is therefore essential: 210 ms is not a complete simulated-user interaction time.

These were virtual HTTP visitors, not full browsers. The test excluded JavaScript execution, static assets, Google sign-in, Sheets storage, saves, card ratings, OCR, AI generation, community polling, and WebSockets. No failure boundary was reached. Forty visitors is the highest level tested in this profile, not the site's maximum capacity. Short runs from one network location do not establish sustained availability.

Raw data: [load-test-2026-11-01.json](load-test-2026-11-01.json).

## Verified storage and generation constraints

The local audit executes the production review/progress function bodies against an in-memory Sheets adapter. Both first-time and existing-card scenarios produced these counts:

| Normal card-rating interaction | Sheets reads | Sheets writes |
| --- | ---: | ---: |
| `POST /api/reviews` | 3 | 2 |
| The browser's automatic `GET /api/progress` refresh | 2 | 0 |
| Combined | **5** | **2** |

This excludes authentication/profile reads, cold study-set cache reads, schema initialization, and retries. The cost can therefore be higher. The audit sends no external requests and measures operation counts, not live server throughput.

[Google's documented default Sheets quota](https://developers.google.com/workspace/sheets/api/limits) is 60 reads and 60 writes per minute per user per project. Requests made by one service account count as one account. Dawnstudy uses one service account across students. Actual project quotas can differ and were not available for inspection.

Under that default read quota, `60 / 5 = 12` complete card-rating interactions per minute is an **optimistic theoretical ceiling across all students**, before other reads. At one rating every ten seconds, two students alone consume that entire read budget. This is a workload estimate, not a measured maximum of two logged-in accounts: students who only browse and read existing cards create different demand. It does mean the current design should not be sized for a classroom of simultaneous frequent card ratings based on the public baseline.

The actual background queue code accepted six active jobs and rejected a seventh distinct submission. Production configuration has two generation workers: normally two jobs execute and up to four wait. The frontend uses this queue. The legacy `POST /api/generate` route bypasses it, so this is not a universal API admission limit. Provider quotas, generation duration, upload/OCR memory, and Sheets persistence impose additional limits.

## Isolated mixed-use simulation

No production test accounts were needed. The local harness uses the real ASGI application, account/profile lookups, study-set storage functions, card-review scheduling, caches, Sheets retry logic, provider fallback/batching, and background queue. It creates synthetic students and stores all data in memory. External HTTP is blocked. Later stages use locally signed synthetic bearer sessions through the original authentication functions. The retained first stage used a synthetic-identity dependency with the same account/profile lookups; it did not exercise bearer-signature verification and had no quota errors.

Each student loaded their library, progress, and due cards; saved one small set; and then rated a card and refreshed progress every ten seconds. One student in each cohort also generated and saved ten questions, using the real generation flow with two simulated provider responses. Each provider response slept five seconds. This is one generator per cohort, representing 100%, 50%, and 20% of the respective cohorts, rather than a uniform 10% workload.

The storage adapter assumed 50 ms per Sheets HTTP attempt and modeled separate rolling 60-second budgets of 60 reads and 60 writes per service identity. Those are testing assumptions: actual Google refill timing, adjusted quotas, network latency, provider behavior, and Render CPU/RAM were not measured. Each independent stage began with fresh synthetic tables, warm schema headers, cold row caches, and an empty quota window. Every stage lasted at least 65 seconds.

The first stages observed demand without enforcing quotas, so their zero-error results do **not** demonstrate sustainable capacity:

| Students | API requests | Sheets reads | Sheets writes | First read-demand quota exceedance |
| ---: | ---: | ---: | ---: | ---: |
| 1 | 28 | 46 | 14 | None |
| 2 | 44 | 82 | 27 | 50.1 seconds |
| 5 | 92 | 187 | 66 | 20.4 seconds |

The ten-question generation completed and saved in approximately 11 seconds in each demand-only stage. That timing comes from the simulated provider and is not a measurement of live AI performance.

The final **two-student stage enforced the modeled quota**, using the production Sheets HTTP 429 retry and backoff logic. It lasted 66.8 seconds and completed 40 API requests without terminal errors. Of 80 attempted Sheets reads, 72 succeeded and eight received simulated HTTP 429 responses; the accepted count spans more than one minute. Twenty-three writes succeeded. Retries recovered when quota became available, but card-rating p95/max latency rose from **360 ms to 16.6 seconds**, and only ten ratings completed versus twelve in the corresponding demand-only stage. Zero terminal errors therefore did not mean acceptable interactive performance.

The authenticated HTTP queue probe accepted six generation jobs, reported two running and four queued, returned HTTP 429 for the seventh student, and HTTP 409 for a duplicate submission by an already-active student. All six completed after releasing the simulated provider.

For this specific fast-review workload and the assumed default quotas, one student's observed demand fit the budget, while two students experienced severe retry delays. This is a **modeled workload boundary, not a verified production user maximum**. Browsing existing cards, rating less frequently, having adjusted quotas, or changing the storage design changes the result. The live public test did not establish a saturation point.

Raw simulation data: [mixed-load-test-2026-11-01.json](mixed-load-test-2026-11-01.json).

## Reproduce

Public baseline, with Node.js 22+:

```powershell
npm run stress-test -- --output docs/load-test-repeat.json
npm run test:stress-test
```

The script supports `--site`, `--api`, `--stages`, `--seconds`, and `--rps`, and deliberately limits traffic to 20 request starts/second. Use the public test only for public endpoints; do not interpret its results as signed-in capacity.

Storage operation and generation admission audit, with Python 3.11+ and no third-party dependencies:

```powershell
python scripts/audit-study-capacity.py
```

Isolated mixed-use simulation, from a Python environment with the backend's dependencies and `httpx` installed:

```powershell
python scripts/stress-test-mixed.py --output docs/mixed-load-test-repeat.json
```

The script's docstring also describes using a temporary dependency directory. It accepts no live target URL and needs no production tokens or keys. The simulation deliberately excludes OCR, real Google login, social polling, WebSockets, browser rendering, large Sheets datasets, and the hosting network.

To establish a production mixed-use maximum, a representative staging deployment needs a test Sheet, measured actual Sheets/provider quotas, real generation latencies, realistic saved-data sizes and uploads, and server CPU/RAM metrics. Increase student counts until an agreed response-time, error-rate, or generation-wait target fails, then repeat below that boundary for a sustained run. Moving frequent review/progress reads and writes to a database should be the first capacity improvement to assess.
