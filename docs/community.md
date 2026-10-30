# Dawnstudy community and private messaging

New and existing accounts without setup version `2026-10-30` must read and accept the agreement, then choose a public nickname, icon, optional private gender choice and theme. Acceptance version/time is recorded server-side; study generation, AI chats and social mutations enforce setup independently of the overlay. The agreement remains accessible without sign-in from navigation.

## Storage and deployment

The existing service account creates five additional tabs in its existing spreadsheet: `Profiles`, `Friendships`, `UserBlocks`, `EncryptedMessages`, `GameResults`. No new credentials are required. Keep the sheet private. The original account/study schemas remain intact. Auth/profile/friend/block reads share a 30-second process cache with immediate invalidation on writes. Message reads share a five-second cache. Presence uses an ephemeral heartbeat and does not write to Sheets.

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

## YouTube

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
