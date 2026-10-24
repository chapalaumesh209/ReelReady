-- Additive hardening: do not alter existing source objects or draft data.
alter table public.reelready_media_jobs drop constraint reelready_media_jobs_status_check;
alter table public.reelready_media_jobs add constraint reelready_media_jobs_status_check check(status in ('queued','running','completed','failed','cancelled'));
alter table public.reelready_media_jobs add column pool text not null default 'default';
alter table public.reelready_workers add column pool text not null default 'default';
create index reelready_worker_pool_heartbeat on public.reelready_workers(pool,heartbeat desc);
-- Serialise queue admissions globally so concurrent requests cannot bypass either cap.
create function public.reelready_enqueue_media_job(p_owner uuid,p_reel uuid,p_source uuid,p_kind text,p_fingerprint text,p_payload jsonb,p_retry boolean,p_user_cap integer,p_global_cap integer,p_pool text)
returns setof public.reelready_media_jobs language plpgsql security invoker set search_path='' as $$
declare existing public.reelready_media_jobs;
begin
 perform pg_advisory_xact_lock(24629721);
 select * into existing from public.reelready_media_jobs where owner_id=p_owner and fingerprint=p_fingerprint;
 if found and (not p_retry or existing.status not in ('failed','cancelled')) then return next existing; return; end if;
 if (select count(*) from public.reelready_media_jobs where owner_id=p_owner and status in ('queued','running')) >= greatest(1,p_user_cap) then raise exception 'USER_QUEUE_FULL'; end if;
 if (select count(*) from public.reelready_media_jobs where status in ('queued','running')) >= greatest(1,p_global_cap) then raise exception 'GLOBAL_QUEUE_FULL'; end if;
 if existing.id is not null then
  return query update public.reelready_media_jobs set status='queued',stage='Waiting for media worker',safe_error=null,result=null,created_at=now(),updated_at=now() where id=existing.id returning *;
 else
  return query insert into public.reelready_media_jobs(owner_id,reel_id,source_id,kind,fingerprint,payload,pool) values(p_owner,p_reel,p_source,p_kind,p_fingerprint,p_payload,p_pool) returning *;
 end if;
end;$$;
revoke all on function public.reelready_enqueue_media_job(uuid,uuid,uuid,text,text,jsonb,boolean,integer,integer,text) from public,anon,authenticated;
grant execute on function public.reelready_enqueue_media_job(uuid,uuid,uuid,text,text,jsonb,boolean,integer,integer,text) to service_role;
create function public.reelready_claim_media_job(p_lease uuid,p_pool text) returns setof public.reelready_media_jobs language plpgsql security invoker set search_path='' as $$
begin
 update public.reelready_media_jobs set status='failed',stage='Interrupted',safe_error='The media worker stopped. Your source is safe. Retry this operation.',updated_at=now() where status='running' and leased_until<now() and pool=p_pool;
 return query update public.reelready_media_jobs set status='running',stage='Starting',lease_token=p_lease,leased_until=now()+interval '90 seconds',attempts=attempts+1,updated_at=now()
 where id=(select id from public.reelready_media_jobs where status='queued' and pool=p_pool order by created_at for update skip locked limit 1) returning *;
end;$$;
revoke all on function public.reelready_claim_media_job(uuid,text) from public,anon,authenticated;
grant execute on function public.reelready_claim_media_job(uuid,text) to service_role;
-- Old workers remain restricted to the default pool.
create or replace function public.reelready_claim_media_job(p_lease uuid) returns setof public.reelready_media_jobs language sql security invoker set search_path='' as $$ select * from public.reelready_claim_media_job(p_lease,'default'); $$;
create table public.reelready_publish_usage (
 id uuid primary key default gen_random_uuid(), owner_id uuid not null references auth.users(id) on delete cascade,
 job_id uuid not null references public.reelready_jobs(id) on delete cascade, kind text not null check(kind in ('upload','x')),
 created_at timestamptz not null default now(), unique(job_id,kind)
);
alter table public.reelready_publish_usage enable row level security;
revoke all on public.reelready_publish_usage from public,anon,authenticated;
grant all on public.reelready_publish_usage to service_role;
create index reelready_publish_usage_owner_date on public.reelready_publish_usage(owner_id,created_at);
