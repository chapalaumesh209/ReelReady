# Single-flow UI, 24 October 2026

The latest request replaces the workspace/dashboard with direct access to the reel task. The six persisted stages remain Plan → Record → Upload → Audio & Voice → Review → Publish.

- `/` opens the current reel. There is no sidebar, dashboard, breadcrumbs, preferences screen or login. `/studio?id=…` remains compatible; `/settings` returns to the flow.
- One current step, a passive progress indicator and Back/Continue controls. Language/schedule, creator brief, recording notes, caption revisions and advanced audio controls are collapsed until needed. The generated plan collapses its source brief and leaves detailed shot lists in Record.
- Publish owns inline social authorization and disconnection. The current draft is saved before official consent, `/connect` returns to the same reel, and the backend verifies connection state. Callback parameters cannot grant access or inject provider error text.
- Review shows captions for selected destinations, one language selector, editable text/copy/rewrite, optional content notes and an opening-hook disclosure when available.
- After a publish request, the receipt replaces connection/timing controls. Delivery states remain factual; demo results stay labelled. Starting another reel saves the previous reel, keeps its videos and does not cancel accepted schedules.
- The original audio path, private uploads, worker recovery, rate limits, preflight and final publication confirmation are preserved. n8n/provider routing, secrets and hosted resources are unchanged.

## Verification

- `npm run lint`, `npm run typecheck`: passed.
- `npm run test:unit`: 74 passed.
- `npm run test:media`: 8 passed.
- `npm run test:e2e`: 14 passed; includes desktop/390px accessibility, full worker-offline demo, actual local media/rendering, multilingual edits, draft recovery, inline mocked official authorization, cancellation/disconnection, original-source preservation and final publish consent.
- `REELREADY_BUILD_DIR=.next-flow-build npm run build`: passed; separate build output keeps the running development instance intact.
- Premium UI strict static audit: no findings. DESIGN.md lint: zero errors; its existing prose-only format produces one missing-YAML warning.
- Batched desktop/mobile inspection and one confirmation pass completed. Screenshots/logs are in ignored `artifacts/flow-*` and `artifacts/offline-*` files.

No real posts, social approvals, deployment or hosted resource changes occurred. No new environment variables or runtime scripts are needed. The live social publishing service was preserved, not validated with real posts in this UI pass.
