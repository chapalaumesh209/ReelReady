# Direct platform setup

Publishing can now be orchestrated by self-hosted n8n; see [N8N-PUBLISHING.md](N8N-PUBLISHING.md). The official OAuth credentials below are still required. n8n advances approved jobs through a private worker, without receiving social tokens or replacing platform APIs.

Native integrations replace the publishing intermediary in the runtime. Existing legacy rows and the old key remain untouched locally but are not used. No visible ReelReady login or publishing PIN is introduced. Account consent still happens on the official platform.

## Server-only configuration

Set these in `.env.development.local` for local development and in the server/worker secret stores for a separately authorized deployment:

- `APP_URL`: canonical application origin. Production uses public HTTPS.
- `SOCIAL_TOKEN_ENCRYPTION_KEY`: base64 encoding of 32 random bytes. A local key has been generated securely. Keep it stable and identical in server and worker; rotating it requires reconnecting accounts.
- `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`.
- `INSTAGRAM_CLIENT_ID`, `INSTAGRAM_CLIENT_SECRET`, `INSTAGRAM_API_VERSION` (supported pinned default `v24.0`).
- `X_CLIENT_ID`, `X_CLIENT_SECRET`.
- `DEMO_MODE`: safe example/test default `true`. Exact `false` permits confirmed real jobs. The local app currently explicitly selects real mode.

No server secret uses a `NEXT_PUBLIC_` name. Do not paste secrets into chat or commit them. Restart the web server and worker after credential changes.

## Google / YouTube

Enable YouTube Data API v3 in your Google Cloud project. Register a Web application OAuth client and configure its consent screen, test users or approved production access. Register exactly `APP_URL/api/connect/callback/youtube`. Requested scopes are `youtube.upload` and `youtube.readonly`, expanded to their official Google URLs. Consent requests offline access for durable background jobs. The callback exchanges the authorization code, discovers the user's actual channel and encrypts the grant. The worker uses resumable upload sessions and then checks video processing and privacy. Account/project quotas, upload restrictions and any API audit requirements still apply. An accepted upload is not evidence of public visibility.

Sources: [Google OAuth web server flow](https://developers.google.com/identity/protocols/oauth2/web-server), [OAuth policy](https://developers.google.com/identity/protocols/oauth2/policies), [YouTube resumable uploads](https://developers.google.com/youtube/data/guides/using_resumable_upload_protocol), [videos.insert](https://developers.google.com/youtube/v3/docs/videos/insert).

## Instagram

Create a Meta app configured for Instagram API with Instagram Login. Register exactly `APP_URL/api/connect/callback/instagram`; Meta requires an eligible redirect URI, normally public HTTPS even during an intentional integration test. Request `instagram_business_basic` and `instagram_business_content_publish`; configure tester roles and obtain the required production access/review. Only eligible Business or Creator accounts can publish. This flow does not borrow a Facebook Page or another workspace's account. Short-lived credentials are exchanged for a long-lived token and refreshed before expiration. The worker creates a REELS media container from a public signed HTTPS URL, polls its real processing state, publishes only after FINISHED and retrieves the media ID/permalink.

Sources: [official Meta Instagram Login docs](https://developers.facebook.com/docs/instagram-platform/instagram-api-with-instagram-login/business-login), [official publishing guide](https://developers.facebook.com/docs/instagram-platform/instagram-api-with-instagram-login/content-publishing), [Meta-owned API collection](https://www.postman.com/meta/instagram/folder/6raa77c/instagram-api-with-instagram-login). The official Meta documentation server rate-limited automated access during this pass; full live exchange and app-review eligibility remain to be validated with configured developer credentials.

## X

Configure an OAuth 2.0 confidential Web App and register exactly `APP_URL/api/connect/callback/x`. Enable the appropriate write/media developer access and account allowance. Requested scopes: `tweet.read tweet.write users.read offline.access media.write`. The flow uses PKCE S256; rotated refresh tokens are encrypted and refreshed under a database-backed lease. The worker uses `/2/media/upload/initialize`, chunked `/append`, `/finalize`, processing status and finally `/2/tweets`. It never creates a post while media is pending. API access tiers, credits and current per-endpoint quotas apply independently of the application rate limits.

Sources: [X OAuth 2.0 PKCE](https://docs.x.com/fundamentals/authentication/oauth-2-0/authorization-code), [initialize](https://docs.x.com/x-api/media/initialize-media-upload), [append](https://docs.x.com/x-api/media/append-media-upload), [finalize](https://docs.x.com/x-api/media/finalize-media-upload), [status](https://docs.x.com/x-api/media/get-media-upload-status).

## Background delivery and safe retry

Run `npm run worker` on a persistent Node 22 host using the same Supabase project, encryption key, platform app credentials, `DEMO_MODE` and `WORKER_POOL` as the web application. Vercel alone does not run this loop. Existing Docker and worker deployment guidance applies; nothing has been deployed. Publication uses an atomic service-role-only queue and leases. A refresh, another tab or polling cannot resend a post. Failed destinations can be requeued without touching successful destinations. A lost X/Instagram final POST response is uncertain and requires a manual platform check; automatic retry is deliberately blocked.

For an intentional live test, obtain explicit authorization, connect your own developer/test accounts, publish a disposable original clip, verify each actual public link, delete the posts manually, and restore demo mode if this is a public judging link. No such approval/posting was performed by automated verification.

## Speech allowance errors

A configured Gemini key does not guarantee available speech quota. HTTP 429 can reflect per-minute, daily or billing/spend limits for the project. Repeated retries and a new key in the same project do not replenish that allowance. Check the project's active limits/billing in Google AI Studio. The application also enforces its separate UTC daily provider-call budget; the existing local counter was exhausted by earlier non-isolated test runs and has not been reset. Tests are now isolated and cannot consume the live counter. Meanwhile keep the original audio or upload real narration; text and source assets remain saved. No placeholder voice is substituted.

Sources: [Gemini limits](https://ai.google.dev/gemini-api/docs/rate-limits), [billing](https://ai.google.dev/gemini-api/docs/billing/).

Confirmed jobs bind the verified account ID for every destination. Reconnecting a different account never redirects an existing confirmed job; prepare a fresh request after checking existing receipts. Publication leases are renewed while processing, and a stale worker cannot checkpoint or start a second platform commit. Explicit retries reset only confirmed unpublished Instagram/X media; resumable YouTube sessions and known successful IDs remain intact.
