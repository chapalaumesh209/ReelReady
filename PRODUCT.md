Latest UX decision (24 October): open directly into a single reel flow. No dashboard, sidebar or preferences pages. Keep optional controls collapsed and connect accounts inline at Publish. This supersedes earlier navigation specifications; persisted reels, media, queue and provider behavior stay intact.

# ReelReady

The account Connect buttons now invoke a dedicated authenticated n8n workflow. A session-owned, single-use two-minute grant authorizes profile creation/connection for the current creator. n8n creates only missing profiles and returns the selected official authorization link. The separate video workflow uses the approved media URL and existing platform-specific captions/descriptions; it does not regenerate them.

Latest publishing choice: use per-owner Upload-Post profiles and its Connect API behind the existing account screen; approved jobs are dispatched to authenticated n8n webhooks that publish through that provider. Profile/media fields are derived on the server, one-use authorization prevents replay, and per-platform receipts/uncertain commits remain durable. Native integrations and old rows are retained for explicit rollback, not used for new managed jobs. Provider profile/plan limits still apply. See docs/MANAGED-N8N-PUBLISHING.md.

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

Implementation choice under the user's instruction to build from scratch: Next.js App Router with optional retained Sites tooling; server-side generation; Supabase Postgres drafts and private resumable video storage, with browser caching. No ReelReady account or sign-in; explicit social authorization at publishing. User prioritizes a simple, reviewable first version.

Latest publishing decision: self-hosted n8n controls fixed background publication execution through a private authenticated worker bridge. The native autonomous publishing loop is disabled in n8n mode. Official OAuth, encrypted per-creator grants, native upload adapters and Supabase job/receipt ownership remain in the worker/backend. Creators never access or configure n8n workflows. No hosted publishing intermediary is used; platform quotas, eligibility, API access and infrastructure/AI costs remain.

## Users

Solo and team-supported social media creators, especially multilingual Indian creators.

## Product Purpose

One connected workflow per reel: plan ideas, schedule, platforms and languages; record and upload the video; review and revise its English script and captions by voice; create an English audio version; publish or schedule to connected platforms directly through official platform APIs.

## Operating Context

Installed Wispr Flow dictates into ordinary editable fields. Desktop Command Mode can refine selected text. Typing and examples work without Wispr.

## Capabilities and Constraints

Before recording: hook, outline, shot checklist. After recording: Instagram caption/hashtags, Shorts title/description, X post. Language and script separate. Optional caption examples and brand details. Editable results, copy, character counts, validation, loading, retry and private cloud persistence tied to an anonymous browser session. No ReelReady login. Each visitor must explicitly connect their own social accounts directly through official platform APIs before publishing. Keep planning, video and publishing data together. No fabricated analytics or publishing-success claims. Server secrets only. No invented claims. English, Telugu, Hindi and Tamil. Public judging defaults: 200 MB uploads and 90-second videos, configurable server-side; provider/project limits also remain.

## Brand Commitments

ReelReady. Original voice-wave identity inspired by Wispr Flow. Smooth interface. From your voice to your next reel.

## Evidence on Hand

User's detailed accepted specifications in this chat. No verified time-saving benchmark. Sample content must be labelled. Google Gemini generation is connected server-side. Output is schema-validated, checked for platform length and script, and repaired once when needed. Creator-provided links and disclosure text are preserved.

## Product Principles

Fast first result; no mandatory setup; preserve meaning; review before copying; no repeated entry.

## Current workflow decision
The user explicitly replaced the independent before/after modes with a sequential plan → record → upload → review/dub → publish flow. They requested actual English video audio, not only translated captions. The latest explicit decision replaces the former publishing intermediary with official direct integrations. Standard synthetic English voiceover over original visuals is the first dubbing implementation; no voice cloning or lip-sync claim. Official Google, Instagram and X application credentials/approvals are pending owner configuration.

The 23 October completion brief adds a private saved-reel home, a branded account manager, verified Supabase anonymous Auth, durable RLS-owned jobs and preferences, default simulated publication and a final explicit confirmation. Implementation is local only with Vercel documentation; production remains unchanged.

## Audio workflow extension (23 October 2026)
User’s new implementation brief adds Audio & Voice between Upload and Review. Native FFprobe/FFmpeg operate in an asynchronous Supabase-backed worker. Keep original is the default; mute, replace, mix and optional narration are explicit choices. Original files and final renders remain separate. Persist edited transcripts, script, timing segments, voice preferences, measured durations, job state and approved final media. Publishing checks the exact approved asset. A documented Gemini voice subset has delivery descriptors only; unsupported accent/gender metadata and source separation are disclosed rather than fabricated. Live AI calls require configured model access; local media and demo publication remain usable independently. Local only; no automatic deployment.

## Professional caption editor

The creator brief now includes optional audience, exact featured place, desired viewer action and relevant search phrases. Publishing copy is platform-specific and uses a content-grounded agency brief, natural keyword placement, focused hashtags, and a separate bounded AI factual review. Existing manual copy is authoritative for revisions. Caption strategy notes are suggestions and clear after manual text edits. No live trends, search volumes, rankings or guaranteed outcomes are claimed. Planning, captions and change requests use configured writing credentials even in publishing demo mode. Missing keys or two failed attempts produce labelled sample output.

## Pre-submission hardening

Keep the existing six steps and visual identity. Worker-offline creators can select the unchanged original without inspection/render; optional English voiceover and collapsed advanced mixing require the worker. Public-link defaults use bounded uploads/text, atomic owner/IP limits, queue caps, a daily paid-call budget, and conservative anonymous retention. Real publishing requires DEMO_MODE=false, passing preflight and explicit final confirmation. One original 8-second sample reel supports the full no-key/no-worker demo. No deployment or real posts are part of local hardening.

## Production social connection update

Instagram, YouTube and X account authorization is always real. Simulated authorization and fake success states have been removed at the current user’s request. The publishing demo switch is independent; only true provider-confirmed accounts are shown connected. Local real mode still needs the server key, connected accounts and public media configuration before real sending. The public hosted version is unchanged under the local-only constraint.

## 24 October approved scope

The user explicitly selected both the UI overhaul and direct platform integration migration. Shared workspace navigation, real reel cards/actions, creator preferences and data-derived progress replace the prototype layout. Native OAuth grants are encrypted and service-role-only. A durable worker owns direct uploads and status verification. No intermediary is a runtime option, no social consent or real posts occur in automated tests, and no publishing PIN is reintroduced. Preserve anonymous identity and existing assets/legacy records.

## Focused audio decision

The latest request removes the audio console from the creator flow. Keep original or create an English voiceover; reveal only a words field, processing state and final video preview when necessary. The existing durable English preset handles translation, narration and mixing. Retain sources, saved exports and backend capabilities for compatibility. Manual mixing, voice settings, recording tools and segment timing are removed from this UI.

## Full-duration voiceover and regional voices

English voiceover must combine the original video's speech and visual context with creator-requested changes, then adapt narration across the measured duration. Short notes are not the sole source; long source material is condensed to fit. Explicit voice presentation (natural automatic/male/female), US/British/Indian English accent, and natural/casual/friendly/professional delivery are available before generation and via Change voice or words afterward. Use provider-verified catalog metadata for voice identity, preserve prepared words on voice-only changes, and retain the original file. Duration fitting uses natural speech and pauses without invented filler or drastic stretching.
