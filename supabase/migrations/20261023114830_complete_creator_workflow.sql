-- Additive: legacy anonymous drafts and their objects remain untouched.
create table public.reelready_reels (
 id uuid primary key, owner_id uuid not null references auth.users(id) on delete cascade,
 title text not null default 'Untitled reel', step smallint not null default 0 check(step between 0 and 4),
 state jsonb not null default '{}', created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(id,owner_id)
);
create index reelready_reels_owner_updated on public.reelready_reels(owner_id,updated_at desc);
create table public.reelready_preferences (owner_id uuid primary key references auth.users(id) on delete cascade, details jsonb not null default '{}');
create table public.reelready_profiles (owner_id uuid primary key references auth.users(id) on delete cascade, external_profile text not null unique, created_at timestamptz not null default now());
create table public.reelready_connections (owner_id uuid not null references auth.users(id) on delete cascade, platform text not null check(platform in ('instagram','youtube','x')), is_demo boolean not null default false, connected boolean not null, display_name text, checked_at timestamptz not null default now(), primary key(owner_id,platform));
create table public.reelready_media (id uuid primary key default gen_random_uuid(), owner_id uuid not null, reel_id uuid not null, kind text not null check(kind in ('original','english')), bucket text not null default 'reelready-videos', path text not null unique, mime text not null, bytes bigint not null check(bytes>0), metadata jsonb not null default '{}', processing_state text not null default 'uploaded', created_at timestamptz not null default now(), foreign key(reel_id,owner_id) references public.reelready_reels(id,owner_id) on delete cascade);
create index reelready_media_reel_owner on public.reelready_media(owner_id,reel_id);
create table public.reelready_jobs (id uuid primary key, owner_id uuid not null, reel_id uuid not null, idempotency_key text not null, is_demo boolean not null, status text not null check(status in ('pending','submitting','uncertain','processing','scheduled','published','failed','demo')), scheduled_at timestamptz, provider_request_id text, provider_job_id text, payload jsonb not null, created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(owner_id,idempotency_key),unique(id,owner_id), foreign key(reel_id,owner_id) references public.reelready_reels(id,owner_id));
create index reelready_jobs_reel_owner on public.reelready_jobs(owner_id,reel_id,created_at desc);
create table public.reelready_targets (job_id uuid not null, owner_id uuid not null, platform text not null check(platform in ('instagram','youtube','x')), caption text not null, status text not null, published_url text, safe_message text, primary key(job_id,platform), foreign key(job_id,owner_id) references public.reelready_jobs(id,owner_id) on delete cascade);
create index reelready_targets_owner on public.reelready_targets(owner_id);
create table public.reelready_attempts (id uuid primary key default gen_random_uuid(),job_id uuid not null,owner_id uuid not null,kind text not null, safe_code text,created_at timestamptz not null default now(),foreign key(job_id,owner_id) references public.reelready_jobs(id,owner_id) on delete cascade);
create index reelready_attempts_owner_job on public.reelready_attempts(owner_id,job_id);
create table public.reelready_rate_limits (key text primary key, count integer not null, expires_at timestamptz not null);
alter table public.reelready_rate_limits enable row level security;
revoke all on public.reelready_rate_limits from anon,authenticated;
grant all on public.reelready_rate_limits to service_role;
-- SECURITY INVOKER; callable only by the server role. Atomic across serverless instances.
create function public.reelready_take_limit(p_key text,p_limit integer,p_seconds integer) returns boolean language plpgsql security invoker set search_path='' as $$
declare n integer;
begin
 insert into public.reelready_rate_limits(key,count,expires_at) values(p_key,1,now()+make_interval(secs=>p_seconds)) on conflict(key) do update set count=case when reelready_rate_limits.expires_at<now() then 1 else reelready_rate_limits.count+1 end,expires_at=case when reelready_rate_limits.expires_at<now() then now()+make_interval(secs=>p_seconds) else reelready_rate_limits.expires_at end returning count into n;
 return n<=p_limit;
end;$$;
revoke all on function public.reelready_take_limit(text,integer,integer) from public,anon,authenticated;
grant execute on function public.reelready_take_limit(text,integer,integer) to service_role;
DO $$ declare t text; begin
 foreach t in array array['reelready_reels','reelready_preferences','reelready_profiles','reelready_connections','reelready_media','reelready_jobs','reelready_targets','reelready_attempts'] loop
 execute format('alter table public.%I enable row level security',t);
 execute format('revoke all on public.%I from anon,authenticated',t);
 execute format('grant select on public.%I to authenticated',t);
 execute format('grant all on public.%I to service_role',t);
 execute format('create policy "Read own records" on public.%I for select to authenticated using ((select auth.uid()) = owner_id)',t);
 end loop;
 foreach t in array array['reelready_reels','reelready_preferences'] loop
 execute format('grant insert,update,delete on public.%I to authenticated',t);
 execute format('create policy "Insert own records" on public.%I for insert to authenticated with check ((select auth.uid()) = owner_id)',t);
 execute format('create policy "Update own records" on public.%I for update to authenticated using ((select auth.uid()) = owner_id) with check ((select auth.uid()) = owner_id)',t);
 execute format('create policy "Delete own records" on public.%I for delete to authenticated using ((select auth.uid()) = owner_id)',t);
 end loop;
end $$;
