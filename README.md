# ReelReady

A public, single-page creator tool. Describe a video using Wispr Flow or typing, then generate either a recording plan or multilingual publishing text. No login, accounts, scheduling or automatic posting.

## Run locally

Use Node 22.13 or newer. Install dependencies with `npm install`, then run `npm run dev -- --port 3000`. Open http://127.0.0.1:3000.

Server-side generation uses Google Gemini and requires `GEMINI_API_KEY` in an ignored `.env.local` file. `GEMINI_MODEL` defaults to `gemini-3.1-flash-lite`. Never put credentials in a `NEXT_PUBLIC_` variable. Production secrets are set through Sites, not committed or sent to browsers.

When no key is configured, only the exact built-in examples produce clearly labelled prepared outputs. Custom input returns an honest connection error and stays saved. There is no simulated live generation.

## Features

- Before recording: opening hook, short outline, shot checklist.
- After recording: Instagram caption/hashtags, YouTube Shorts title/description, X post.
- English, Telugu and Hindi. Native and Roman script choices are separate from language.
- Optional previous captions, brand name, link, call to action and disclosure.
- Editable output, copy individual/all, character counts, weighted X counting, hashtag counts and limit warnings.
- Schema-validated live generation, bounded correction for length/script issues, and preserved creator-supplied URLs and disclosures.
- Separate drafts/results per mode, browser-local persistence and explicit clear confirmation.
- Loading, cancellation, retry via primary action, IME-safe Enter submission, Shift+Enter for newline.
- Native mobile selects, reduced motion, keyboard focus, screen-reader status and mobile layout.

Wispr Flow runs separately. Click an editable field and use its configured dictation shortcut. Desktop Command Mode can revise selected text. Dictionary and Snippets are managed inside Wispr. No audio is captured by ReelReady.

Input, creator details and results are stored in the current browser only. On generation, input and optional details are sent to the server and the configured model provider; the app uses stateless Gemini generateContent requests and does not create a provider-side conversation history. No analytics or server-side user database is included. Local drafts are not shared across devices.

## Checks

`npx tsc --noEmit`

`npx playwright test` (configuration uses installed Google Chrome on macOS)

`RUN_LIVE_TESTS=1 npx playwright test tests/live.spec.ts` runs real multilingual generation checks using the server credential.

`npm run build`

`python /absolute/path/to/frontend-design-premium/scripts/audit_project.py . --mode strict`

The open generation endpoint has per-instance rate limiting and bounded input/output. For sustained public traffic, set a provider project budget and deploy a durable edge rate limiter. No creator analytics, performance guarantees, or guaranteed time-saving claims are made.
