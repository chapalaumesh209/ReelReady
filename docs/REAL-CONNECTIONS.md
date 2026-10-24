# Real account connections

Current mode uses authenticated n8n account and publishing workflows with the managed provider. See [MANAGED-N8N-PUBLISHING.md](MANAGED-N8N-PUBLISHING.md) and [N8N-TWO-FLOWS.md](N8N-TWO-FLOWS.md). Direct platform OAuth is retained only for explicit native mode; its setup is documented in [DIRECT-SOCIAL-SETUP.md](DIRECT-SOCIAL-SETUP.md).

The backend derives each creator's provider profile from their anonymous Supabase session. A destination is Connected only when that exact profile returns a valid account identifier and no reconnection requirement. Callback query flags never grant access. No visible login or publishing PIN is used.

The current reel workspace now owns the existing Instagram-connected profile following the user's explicit transfer approval. The older workspace no longer accesses that profile; no reels or remote profiles were deleted. YouTube and X authorization starts were verified against their official authorization hosts, but neither is connected until the creator approves those screens. The account has two occupied profile slots, so unrelated new workspaces still need available profile capacity.

Managed n8n publishing defaults to private binary transfer: the worker reads the owned file and n8n sends bytes to the provider. A public storage URL is not required in this path. The long-lived worker, private bridge and n8n must be online. Actual provider/platform plan limits still apply.

The application and workflows were changed locally. No hosted resource, OAuth approval or real social post was performed.
