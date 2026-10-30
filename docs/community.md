# Dawnstudy community and private messaging

New and existing accounts without setup version `2026-10-30` must read and accept the agreement, then choose a public nickname, icon, optional private gender choice and theme. Acceptance version/time is recorded server-side; study generation, AI chats and social mutations enforce setup independently of the overlay. The agreement remains accessible without sign-in from navigation.

## Storage and deployment

The existing service account creates five additional tabs in its existing spreadsheet: `Profiles`, `Friendships`, `UserBlocks`, `EncryptedMessages`, `GameResults`. No new credentials are required. Keep the sheet private. Existing account columns and study records are preserved; `StudySets` adds `items_json_2` through `items_json_10` for longer sets of up to 100 questions, while older single-cell JSON remains readable. Auth/profile/friend/block reads share a 30-second process cache with immediate invalidation on writes. Message reads share a five-second cache. Presence uses an ephemeral heartbeat and does not write to Sheets.

Continue using **one Uvicorn worker** as configured in `render.yaml`. Quiz rooms are server-authoritative process memory, expire after an hour without activity, and disappear when Render restarts. A shared database/pubsub implementation is required before deploying multiple API workers or instances. Finished standings are appended in one Sheets request per game. This is a low-traffic prototype, not a high-volume messaging backend; monitor Sheets quotas as usage grows.

## Friend and messaging boundaries

- Discovery is explicitly opt-in and defaults to off. Public directory records expose nickname, icon, user ID and a short friend tag, never account email or gender. Presence is visible to accepted friends, not the directory.
- Only the recipient can accept or decline a pending friend request. Users may cancel, unfriend, block and unblock. Unfriending/blocking prevents further private-message reads and sends through the API. Previously delivered ciphertext remains in storage until a deletion request is handled.
- Browser Web Crypto generates P-256 ECDH keys. Shared bits feed HKDF-SHA256 and AES-256-GCM. Every message has a random 32-byte salt and 12-byte IV; sender, recipient and public-key fingerprints are authenticated as additional data.
- Private keys are kept in IndexedDB and never sent to the server. Server models forbid plaintext message fields and private JWK fields. The spreadsheet stores an encrypted envelope, sender/recipient IDs, time and an idempotency identifier. The operator can see this metadata.
- Keys are pinned on first contact. Safety codes can be compared out of band; changed keys interrupt messaging. The server refuses silent public-key replacement. This is trust on first use, not independent identity certification.
- Passphrase-encrypted recovery files use PBKDF2-SHA256 (600,000 iterations) and AES-GCM. At least 12 passphrase characters are required. Recovery files/passphrases are never uploaded to the API. Losing browser data and the backup loses message access; the operator cannot recover it. Web Locks serialize key creation across tabs on supported browsers.
- The implementation does not claim forward secrecy, independent security audit, or protection from a compromised device, recipient screenshots, or malicious same-origin application code. AI companion/voice conversations are separate and are sent in readable form to the configured AI provider.

## Live quizzes

The host chooses a saved scored quiz (multiple-choice, select-all or identification), shares a six-character code or invites accepted friends, then starts with at least two players. Up to 12 players and 30 questions are supported. The server sets 25-second deadlines, accepts one answer per player per question, rejects stale/late answers, and withholds answers/explanations until reveal. Correct answers earn 1,000 points plus up to 500 for speed. Ties share a placement. Clients reconnect using an account-scoped stored room code. Sounds are synthesized locally and opt-in; reduced-motion settings suppress decorative animation.

## Companion, icons and themes

Companion names save explicitly to the account profile; guests can keep local settings. Occasional speech appears every 150 seconds while the page is visible, remains for 9–18 seconds based on length, and dismisses on click/touch. Quiet mode pauses it. Avatar taps open a companion chat with settings available separately. Friendly replies use the existing provider keys. A loneliness cue offers an optional Friends link. History is session-only in the browser, can be cleared, and is not saved to Sheets.

There are 10 animal and 9 stylized character companions, plus 96 portrait variants (two presentation styles, six outfits, eight looks) for 115 profile icons. Sanrio references: [official character brands](https://corporate.sanrio.co.jp/en/business-info/brands). Portraits are labeled **CEU-inspired**, because the [official CEU school pages](https://manila.ceu.edu.ph/static/index.html) do not establish a complete current catalogue of every departmental uniform. The gallery does not claim official uniform accuracy or institutional/character-brand affiliation. All styles are available regardless of gender choice.

Themes are Morning (soft light), Midnight (dark) and Rose Dawn (blush/plum). Profile preferences sync across devices. Navigation exposes Study, Library, Friends and Play directly on mobile, with Finder, Voice, Profile, Agreement and About in More.

## Companion safety routing

The companion is a non-clinical AI study tool. Crisis care, therapy, diagnosis, medication advice and emergency dispatch are outside its role. Ordinary loneliness, wanting company and everyday study stress receive a warm invitation to find study friends, without counselling disclaimers, hotlines or clinical referrals. Severe or persistent distress can receive real-world support contacts; explicit therapy/diagnosis requests and urgent danger retain their respective boundaries and responses. Victim disclosures are handled as requests for support, distinct from a user's harmful intent.

`backend/companion_safety_policy.json` is the public, shared registry for responses, contact links and common English/Filipino routing patterns. Both the browser and API use it. Clear self-harm, overdose, violence and urgent danger cues show fixed Philippine help contacts immediately. Browser handling works without AI access, without sign-in and offline after the app has loaded. It interrupts an in-flight AI chat and prevents an older answer from overwriting the help. The server repeats the checks before provider calls and before the conversational rate limiter. These safeguards are routing rules, not diagnoses or an exhaustive understanding of every phrase.

Requests or intent to facilitate crime or harmful conduct use exactly: `I can't engage with that kind of conversation.` An imminent threat to another person retains that refusal and adds emergency contacts. Educational definitions, reporting a crime, victims seeking help, negations and technical phrases such as killing a process are distinguished in the fixtures. Recent context informs short follow-ups, while a clear return to a harmless study topic ends that escalation.

For messages not matched by those rules, providers must return a structured safety category plus a short normal reply. All non-normal categories map to fixed server responses; their generated reply text is discarded. Invalid output is rejected and another configured provider can be tried. Model-invented crisis contact details and therapist/diagnosis scripts are not displayed. This reduces risk; it is not a guarantee that automated classification can identify every possible unsafe message.

Contacts were checked on 30 October 2026. The Philippine emergency number comes from the [government hotline directory](https://ehotlines.e.gov.ph/). The NCMH phone/contact link comes from the dedicated Philippine helpline lookup, not model memory; its linked [service page](https://www.facebook.com/ncmhcrisishotline?mibextid=LQQJ4d&oai_link_source=model_response_hotline) is included in the registry. `gcd@ceu.edu.ph` is the campus contact supplied by the project owner; the [official CEU GCD services page](https://www.ceu.edu.ph/static/campus-life/10.html) provides department context. Do not invent additional numbers, claim guaranteed access or response times, or silently replace these contacts with model-generated text. The UI explicitly states that campus email is not for emergencies and Dawnstudy does not call, email or dispatch help.

Recognized safety messages handled locally are not sent to an AI provider. Browser session history can retain the displayed conversation until cleared; this does not add spreadsheet storage, operator alerts or automatic reports. A permanent help button opens the same contact card. Refresh preserves the card, and emergency rendering scrolls its primary call action into view.

Run `node --test tests/companion-safety.test.mjs` for shared browser-routing fixtures and the backend test suite for matching Python, API bypass and model-output checks. With the local browser QA setup below, `node tests/companion-safety-browser.mjs` verifies urgent interruption, offline/guest access, exact refusal wording, refreshed cards, and mobile/tablet/desktop layout using only mock accounts and requests.

Legacy local assistant replies to recognized safety messages are upgraded on load, and an unfinished urgent user turn receives a local response after refresh. Ordinary saved study conversation stays intact. `GET /api/community/safety-policy` exposes the public contact registry and version without authentication or storage access, for help availability and deployment verification.

## YouTube material extraction

YouTube watch, youtu.be, shorts, live and embed URLs are canonicalized to a validated video ID. Captions are tried first using [youtube-transcript-api](https://github.com/jdepoix/youtube-transcript-api). If captions cannot be fetched, the existing Gemini key can extract paraphrased study notes from a public video using the [official video input capability](https://ai.google.dev/gemini-api/docs/video-understanding). Interactions requests set `store=false`; optional `YOUTUBE_GEMINI_MODEL` defaults to `gemini-3.8-flash`. No new key is needed. Private/age-restricted/unavailable content is not bypassed; inaccessible videos return a clear transcript-upload alternative. Fingerprints use the canonical video ID so continuation remains consistent even when an AI outline varies.

## Agreement and privacy operations

The in-app agreement references the [Data Privacy Act of 2012](https://privacy.gov.ph/data-privacy-act/) and [NPC implementing rules](https://privacy.gov.ph/wp-content/uploads/2023/06/IRR_RA-10173-as-amended.pdf). It explains processing purposes, public/optional fields, providers, ciphertext versus metadata, retention, access/correction/deletion/objection rights and contact information. This is a project-specific notice, not a claim of legal certification. Handle privacy/export/deletion and abuse requests through the displayed contact, verify ownership, and remove relevant records from every applicable tab. Do not request passwords or private encryption keys. Deleting a connection does not automatically delete messages or an account.

## Verification

Install backend dependencies and `httpx`, then run:

```sh
python -m unittest discover -s backend -p 'test_*.py'
node --test tests/generation-jobs.test.mjs
pnpm build
```

The browser regression suite uses only mocked accounts/API records and real browser Web Crypto/IndexedDB. Install `playwright-core` in a temporary QA directory; run Next dev on port 3033 with `NEXT_PUBLIC_API_URL=http://localhost:8000` (the suite intercepts this address). Set `DAWNSTUDY_PLAYWRIGHT_PATH` to its `index.mjs` and `DAWNSTUDY_BROWSER` to an installed Chromium/Edge executable, then:

```sh
node tests/community-browser.mjs
```

It checks onboarding, account companion rename and history recovery, two independent messaging participants, ciphertext-only transport, encrypted key recovery in a fresh browser, a two-player quiz through the podium, desktop/tablet/mobile overflow, navigation and timed bubble dismissal. Screenshots/recovery files are written to the system temporary directory, never the repository or production storage.
