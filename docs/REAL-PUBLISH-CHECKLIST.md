# Manual real publishing check — not performed automatically

1. Follow DIRECT-SOCIAL-SETUP.md. Configure official developer app credentials, a stable shared encryption key, public HTTPS application/storage URLs and a running background worker. Use your own developer/test accounts and required platform permissions.
2. Set DEMO_MODE=false intentionally. Connect each account through its official consent page and verify its identity in Accounts. No publishing PIN is required.
3. Upload a disposable original 5–90 second portrait 9:16 H.264/AAC MP4. Inspect and approve the selected soundtrack and media. Resolve the preflight blockers and review the exact captions.
4. Confirm publication explicitly. Check every independent platform receipt and real link. A queued upload, completed transfer, private YouTube upload or uncertain API response is not confirmed public publication.
5. Verify real visibility, remove the disposable posts manually, then restore DEMO_MODE=true for a public judging link if desired.

Scheduling is durable inside ReelReady and depends on the long-lived worker. It never publishes before the chosen UTC instant. Signed Instagram media URLs are generated afresh during delivery. Uncertain final Instagram/X POST responses are paused for manual reconciliation, without automatic resend. Successful destinations stay intact when retrying confirmed failures.
