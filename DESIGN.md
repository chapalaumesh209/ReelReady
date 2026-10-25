# ReelReady design

## Overview

Operate mode. An airy lavender voice studio with a six-step reel workflow and editable output sheets. Brand inspiration is Wispr Flow's friendly voice-driven identity; original reel/wave mark, no copied sponsor logo. User's pinned voice theme and simple single-page task govern the world. Build directly for fast review.

## Colors

Runtime source: app/globals.css :root. paper #f9f8fc, ink #24202c, muted #6b6278, lavender #e8dcff, accent #6843aa, accent-hover #55358e, line #e5e0eb, white #ffffff. Semantic success #316746, error #a52b42. Border-led surfaces, subtle offset shadows reserved for busy status bar. 14px surfaces, 9px controls, pill tabs.

## Typography

Self-hosted DM Sans for UI and Manrope for display. Telugu/Hindi/Tamil use self-hosted Noto Sans Telugu/Devanagari/Tamil with system fallback. Task headings 32px desktop / 28px mobile; body 15px; metadata 12px. Tracking no tighter than -.035em.

## Layout

A single task surface, opening directly at /. No dashboard, sidebar, breadcrumb navigation or preferences page. A compact logo/save header frames a 728px task column; six quiet progress segments mark the existing sequence without becoming competing navigation controls. Each step shows one main action. The idea box is the signature lavender surface; other content sits directly on white. At 600px the column becomes full width with 22px gutters and stacked primary actions. Optional language/schedule, creator details, caption revision and advanced audio controls use native disclosures. Account connections live in Publish and official authorization returns to the same saved reel. /studio remains a compatible deep link; /settings returns to the flow; /connect only handles OAuth return.

## Motion

180ms control transitions; one result reveal. Reduced-motion disables animation. Busy button dimensions stable.

## Controls and states

Native select ownership for operating-system keyboard/mobile behavior; labelled fields. Native multiline Enter and IME behavior. Step navigation preserves one reel’s input, media and results. Optional brand details closed by default. Results ordinary editable textareas with auto-height, individual copy and all-copy. Counts and exceeded limits update after every edit. Inline errors preserve input; dismissible help section; status aria-live.

## Browser surfaces

Visible focus; custom selection/caret/scrollbars; themed color-scheme light; no hidden scrollbars. Native select popup accepted.

Video selection uses a visible native file input styled through ::file-selector-button. Never replace it with a hidden input and a synthetic click. A chooser attempt reveals drag/drop and external-browser guidance; metadata checking is cancellable and bounded.

Publish and disconnect use the shared native modal dialog wrapper with initial focus on the safe action, native focus containment/Escape behavior, and focus restoration. The current reel resumes at its stable URL and in this browser. Demo publication remains visibly labelled.

## Audio & Voice extension
The sixth-stage workflow inserts Audio & Voice between Upload and Review. Reuse the existing panel, native selects, AutoTextarea, inline feedback and ConfirmDialog. Keep the original-audio decision first and progressively reveal narration only when selected. The source preview and measured stream summary remain visible; optional voice-note and source-separation explanations use native details. No replacement of the established lavender identity. Native range controls own volume/fade input; labelled numeric fields own timing. Media preview uses anonymous CORS with owner-authorized signed URLs. Source audio information is explicitly labelled Original so it cannot be mistaken for rendered metadata.

## Caption strategy refinement

Audience/place/goal/search-term fields extend the canonical collapsed CreatorDetails control. The review screen exposes generated search guidance in a native details disclosure before the same OutputEditor; no new screen, modal, ranking score or setup requirement. Notes clear when edited copy changes. Native disclosures and shared AutoTextarea remain the canonical interaction. Review grid children allow shrinking and long multilingual source text wraps inside the mobile workspace.

## Pre-submission extension

Preserve lavender tokens and all six steps. Default Audio & Voice to unchanged original with one prominent Continue; group all manual audio controls under native Advanced disclosure. Keep unavailable processing calm and actionable. Label canned writing Sample output. Use shared inline feedback and native disclosures for preflight details; show blockers immediately and collapse informational real-publish warnings in demo mode. Publishing uses the existing final confirmation dialog; no PIN field or PIN setup is required (current user request). Sample animation is original geometric artwork and a quiet generated test tone.

## Real social authorization

Account connection controls always start real platform OAuth. No simulated connect buttons or fake connected labels. The publishing demo switch affects sending only, independently of authorization. Missing owner configuration disables connect actions with explicit guidance; a callback flag never proves connection. Reconnect states remain visible and only server-verified identities appear connected. Keep canonical inline account controls, inline errors and ConfirmDialog.

## Single-flow simplification (24 October)

The latest request supersedes the earlier dashboard/sidebar overhaul. Retain identity, backend ownership, saved data, all six task stages, audio editing and real publishing. Remove navigation and preferences from the creator experience, rather than deleting saved reels or server capabilities. No new marketing, decorative metrics, or infrastructure details in creator copy. New reels start from the delivery result; accepted schedules and old assets remain intact. Confirmation, preflight blockers, sample labels and failures stay visible when relevant. Runtime token source remains app/globals.css :root; the single-flow section owns layout overrides. Existing token drift was corrected in this document to the unchanged runtime values.

## Focused Audio & Voice (latest request)

Replace the mixing-console UI with two clearly labelled sound choices: keep original, or English voiceover. Original is the default and needs only Continue. English reveals one dictation-friendly words field and one Create action; transcription, translation, the fixed natural voice, quieter source audio and export are automatic. Show progress, then a playable finished video with optional Change the words. No manual classification, voice catalogue, language/style selectors, sliders, fades, timeline segments or separate rendering step. Existing approved custom exports reopen directly at their finished preview without a new paid operation. No assets or backend audio capabilities are deleted. The global stage count and single-flow shell are unchanged.

The Audio & Voice subflow replaces content in place: initial sound choice → words → finished preview. It never shows the full choice list, words editor and finished result at once. Original preview stays in a native disclosure; background inspection does not compete with Continue.

## Duration and voice choices (latest request)

Keep the progressive Audio & Voice flow. The English task adds only three relevant labelled native selects: voice presentation (natural automatic / male / female), accent (US / British / Indian English), and delivery (natural / casual / friendly / professional). All sit inside the existing words task; Change voice or words reopens it after completion. Labels sit outside select elements so option text never becomes the label. A read-only narration disclosure identifies the measured fitted duration; no manual timeline, sliders or extra page returns.

## Live production content

The production flow offers no sample idea/video shortcuts and ignores sample URL seeds. Those shortcuts appear only when the server explicitly allows sample output and demo publishing together. Real writing, analysis and captions never silently substitute canned content. Existing creator drafts remain preserved. No visual tokens or workflow stages change.
