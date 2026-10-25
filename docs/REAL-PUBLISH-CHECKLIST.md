# Manual real publishing check — not performed automatically

1. Follow DIRECT-SOCIAL-SETUP.md. Configure official developer app credentials, a stable shared encryption key, public HTTPS application/storage URLs and a running background worker. Use your own developer/test accounts and required platform permissions.
2. Set DEMO_MODE=false intentionally. Connect each account through its official consent page and verify its identity in Accounts. No publishing PIN is required.
3. Upload a disposable original 5–90 second portrait 9:16 H.264/AAC MP4. Inspect and approve the selected soundtrack and media. Resolve the preflight blockers and review the exact captions.
4. Confirm publication explicitly. Check every independent platform receipt and real link. A queued upload, completed transfer, private YouTube upload or uncertain API response is not confirmed public publication.
5. Verify real visibility, remove the disposable posts manually, then restore DEMO_MODE=true for a public judging link if desired.

Scheduling is durable inside ReelReady and depends on the long-lived worker. It never publishes before the chosen UTC instant. Signed Instagram media URLs are generated afresh during delivery. Uncertain final Instagram/X POST responses are paused for manual reconciliation, without automatic resend. Successful destinations stay intact when retrying confirmed failures.

### Original MP4 inspection without the media worker

Real preflight automatically reads the selected private MP4's container metadata on the server. It checks actual codec identifiers, display rotation/dimensions and duration, caches the result on that media row, and never treats browser metadata as proof. This also works for existing uploads: refresh and run **Check publishing setup** again. No re-upload is needed for an already-compatible MP4.

This bounded range inspection downloads at most 4 MiB of metadata, skips large media payloads, and needs no FFmpeg worker or paid AI call. It does not decode the full recording or render/convert incompatible video. The separate `streamInspected` marker deliberately does not set `decoded`. H.264/AAC, 9:16 and duration checks still apply. Unsupported containers/codecs or an incomplete inspection remain blocked; export a standard MP4 or retry a transient storage failure. Voiceovers and transcoding still require the media worker.
