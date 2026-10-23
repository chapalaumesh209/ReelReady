# ReelReady design

## Direction

Operate mode. An airy lavender voice studio with a central composer and editable output sheets. Brand inspiration is Wispr Flow's friendly voice-driven identity; original reel/wave mark, no copied sponsor logo. User's pinned voice theme and simple single-page task govern the world. Build directly for fast review.

## Tokens

Runtime source: app/globals.css :root. paper #f9f8fc, ink #24202c, muted #6b6278, lavender #e8dcff, accent #6843aa, accent-hover #55358e, line #e5e0eb, white #ffffff. Semantic success #316746, error #a52b42. Border-led surfaces, subtle offset shadows reserved for help popover. 14px surfaces, 10px controls, pill tabs.

## Typography

Self-hosted DM Sans for UI and Manrope for display. Telugu/Hindi use self-hosted Noto Sans Telugu/Devanagari with system fallback. Display 52px desktop / 36px mobile; body 15px; metadata 12px. Tracking no tighter than -.035em.

## Layout

1040px container. Minimal header; centered functional introduction; 760px composer; generated results below. Small screens stack actions and language fields. No hero art or dashboard. Signature: a five-bar waveform becomes a play chevron in the original logo and the generating indicator.

## Motion

180ms control transitions; one result reveal. Reduced-motion disables animation. Busy button dimensions stable.

## Controls and states

Native select ownership for operating-system keyboard/mobile behavior; labelled fields. Enter submits primary prompt, Shift+Enter newline, IME safe. Mode switches preserve separate prompts/results. Optional brand details closed by default. Results ordinary editable textareas with auto-height, individual copy and all-copy. Counts and exceeded limits update after every edit. Inline errors preserve input; dismissible help popover; status aria-live.

## Browser surfaces

Visible focus; custom selection/caret/scrollbars; themed color-scheme light; no hidden scrollbars. Native select popup accepted.
