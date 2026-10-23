create table public.reelready_drafts (
  visitor_id uuid primary key,
  draft_id uuid not null,
  state jsonb not null,
  updated_at timestamptz not null default now()
);
alter table public.reelready_drafts enable row level security;
revoke all on public.reelready_drafts from anon, authenticated;
grant all on public.reelready_drafts to service_role;
comment on table public.reelready_drafts is 'Private ReelReady drafts. Access is only through server-verified anonymous visitor sessions.';
