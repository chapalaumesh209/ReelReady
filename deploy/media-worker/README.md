---
title: ReelReady Media Worker
emoji: 🎙️
colorFrom: purple
colorTo: gray
sdk: docker
app_port: 7860
pinned: false
---

Private media processing for ReelReady. The HTTP interface reports readiness only; it accepts no uploads, commands or publishing requests. The process reads authenticated, owner-scoped jobs from the private Supabase queue and stores results in private storage.

Configure runtime secrets through the hosting dashboard, never in this repository. `MEDIA_WORKER_ONLY=true` prevents account connection and social publication dispatch. Scheduling and publishing remain with the separately hosted n8n coordinator.
