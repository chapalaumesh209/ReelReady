-- Additive local feature. Preserve legacy source assets and publication records.
alter table public.reelready_reels drop constraint reelready_reels_step_check;
alter table public.reelready_reels add constraint reelready_reels_step_check check(step between 0 and 5);
-- Map saved five-step reels once, preserving all other draft data.
update public.reelready_reels set step=case when step>=3 then step+1 else step end,
 state=jsonb_set(jsonb_set(state,'{step}',to_jsonb(case when step>=3 then step+1 else step end)),'{workflowVersion}','3');
alter table public.reelready_media drop constraint reelready_media_kind_check;
alter table public.reelready_media add constraint reelready_media_kind_check check(kind in ('original','english','source_audio','voiceover','rendered'));
alter table public.reelready_media add constraint reelready_media_id_owner unique(id,owner_id);
create table public.reelready_audio_edits (
 reel_id uuid primary key, owner_id uuid not null, source_id uuid not null,
 settings jsonb not null default '{}', transcript text not null default '', script text not null default '',
 classification text not null default 'unknown' check(classification in ('unknown','speech','background','mixed','silent','none')),
 segments jsonb not null default '[]', rendered_id uuid, approved_hash text, updated_at timestamptz not null default now(),
 foreign key(reel_id,owner_id) references public.reelready_reels(id,owner_id) on delete cascade,
 foreign key(source_id,owner_id) references public.reelready_media(id,owner_id),
 foreign key(rendered_id,owner_id) references public.reelready_media(id,owner_id)
);
create index reelready_audio_owner on public.reelready_audio_edits(owner_id);
create table public.reelready_media_jobs (
 id uuid primary key default gen_random_uuid(), owner_id uuid not null, reel_id uuid not null, source_id uuid not null,
 kind text not null check(kind in ('analyze','transcribe','suggest','translate','preview','generate','render')),
 status text not null default 'queued' check(status in ('queued','running','completed','failed')),
 stage text not null default 'Waiting for media worker', fingerprint text not null, payload jsonb not null,
 result jsonb, safe_error text, lease_token uuid, leased_until timestamptz, attempts integer not null default 0,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 foreign key(reel_id,owner_id) references public.reelready_reels(id,owner_id) on delete cascade,
 foreign key(source_id,owner_id) references public.reelready_media(id,owner_id), unique(owner_id,fingerprint)
);
create index reelready_media_jobs_owner_reel on public.reelready_media_jobs(owner_id,reel_id,created_at desc);
create index reelready_media_jobs_queue on public.reelready_media_jobs(created_at) where status='queued';
create table public.reelready_workers(id text primary key, heartbeat timestamptz not null);
alter table public.reelready_workers enable row level security;
revoke all on public.reelready_workers from public,anon,authenticated;
grant all on public.reelready_workers to service_role;
DO $$ declare t text; begin
 foreach t in array array['reelready_audio_edits','reelready_media_jobs'] loop
 execute format('alter table public.%I enable row level security',t);
 execute format('revoke all on public.%I from public,anon,authenticated',t);
 execute format('grant select on public.%I to authenticated',t);
 execute format('grant all on public.%I to service_role',t);
 execute format('create policy "Read own media work" on public.%I for select to authenticated using ((select auth.uid())=owner_id)',t);
 end loop;
end $$;
-- Only a trusted worker can claim work. A lease expires safely after a crash;
-- interrupted jobs fail for an explicit user retry, avoiding duplicate AI charges.
create function public.reelready_claim_media_job(p_lease uuid) returns setof public.reelready_media_jobs language plpgsql security invoker set search_path='' as $$
begin
 update public.reelready_media_jobs set status='failed',stage='Interrupted',safe_error='The media worker stopped. Your source is safe. Retry this operation.',updated_at=now() where status='running' and leased_until<now();
 return query
 update public.reelready_media_jobs set status='running',stage='Starting',lease_token=p_lease,leased_until=now()+interval '90 seconds',attempts=attempts+1,updated_at=now()
 where id=(select id from public.reelready_media_jobs where status='queued' order by created_at for update skip locked limit 1) returning *;
end;$$;
revoke all on function public.reelready_claim_media_job(uuid) from public,anon,authenticated;
grant execute on function public.reelready_claim_media_job(uuid) to service_role;
update storage.buckets set allowed_mime_types=array['video/mp4','video/webm','video/quicktime','audio/wav','audio/x-wav','audio/mpeg','audio/mp4','audio/webm','audio/ogg','audio/flac','audio/aac'] where id='reelready-videos';
