-- Additive native-platform grants. Existing intermediary records are preserved but never reused.
create table public.reelready_social_credentials (
 owner_id uuid not null references auth.users(id) on delete cascade,
 platform text not null check (platform in ('youtube','instagram','x')),
 account_id text not null, display_name text not null,
 encrypted_credentials text not null, updated_at timestamptz not null default now(),
 primary key(owner_id,platform)
);
create table public.reelready_oauth_states (
 state_hash text primary key, owner_id uuid not null references auth.users(id) on delete cascade,
 platform text not null check(platform in ('youtube','instagram','x')),
 encrypted_verifier text not null, redirect_uri text not null,
 expires_at timestamptz not null, consumed_at timestamptz
);
create index reelready_oauth_owner_expires on public.reelready_oauth_states(owner_id,expires_at);
alter table public.reelready_social_credentials enable row level security;
alter table public.reelready_oauth_states enable row level security;
revoke all on public.reelready_social_credentials, public.reelready_oauth_states from public,anon,authenticated;
grant all on public.reelready_social_credentials, public.reelready_oauth_states to service_role;
alter table public.reelready_jobs add column worker_pool text not null default 'default', add column lease_until timestamptz, add column worker_id text, add column next_attempt_at timestamptz;
alter table public.reelready_targets add column native_state text;
-- The encrypted upload checkpoint may contain a resumable URL; never plaintext.
create index reelready_native_queue on public.reelready_jobs(worker_pool,next_attempt_at) where not is_demo and provider_request_id='native';
create function public.reelready_queue_publication(p_job uuid,p_owner uuid,p_pool text,p_user_limit integer,p_global_limit integer) returns boolean language plpgsql security invoker set search_path='' as $$
begin
 perform pg_advisory_xact_lock(73042);
 if (select count(*) from public.reelready_jobs where not is_demo and provider_request_id='native' and status in ('processing','scheduled','submitting') and owner_id=p_owner)>=p_user_limit then raise exception 'PUBLICATION_USER_CAP'; end if;
 if (select count(*) from public.reelready_jobs where not is_demo and provider_request_id='native' and status in ('processing','scheduled','submitting'))>=p_global_limit then raise exception 'PUBLICATION_QUEUE_CAP'; end if;
 update public.reelready_jobs set status=case when scheduled_at>now() then 'scheduled' else 'processing' end,provider_request_id='native',worker_pool=p_pool,next_attempt_at=coalesce(scheduled_at,now()),updated_at=now() where id=p_job and owner_id=p_owner and status='pending' and not is_demo;
 return found;
end;$$;
create function public.reelready_claim_publication(p_pool text,p_worker text) returns setof public.reelready_jobs language sql security invoker set search_path='' as $$
 with candidate as (select id from public.reelready_jobs where not is_demo and provider_request_id='native' and worker_pool=p_pool and status in ('processing','scheduled','submitting') and next_attempt_at<=now() and (lease_until is null or lease_until<now()) order by next_attempt_at for update skip locked limit 1)
 update public.reelready_jobs j set worker_id=p_worker,lease_until=now()+interval '5 minutes',status='submitting',updated_at=now() from candidate c where j.id=c.id returning j.*;
$$;
revoke all on function public.reelready_queue_publication(uuid,uuid,text,integer,integer),public.reelready_claim_publication(text,text) from public,anon,authenticated;
grant execute on function public.reelready_queue_publication(uuid,uuid,text,integer,integer),public.reelready_claim_publication(text,text) to service_role;
