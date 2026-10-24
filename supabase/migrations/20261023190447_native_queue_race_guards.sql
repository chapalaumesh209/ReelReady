-- Make per-destination admission atomic with queue visibility; a worker never sees half-queued retries.
create or replace function public.reelready_queue_publication(p_job uuid,p_owner uuid,p_pool text,p_user_limit integer,p_global_limit integer) returns boolean language plpgsql security invoker set search_path='' as $$
declare admitted boolean;
begin
 perform pg_advisory_xact_lock(73042);
 if (select count(*) from public.reelready_jobs where not is_demo and provider_request_id='native' and status in ('processing','scheduled','submitting') and owner_id=p_owner)>=p_user_limit then raise exception 'PUBLICATION_USER_CAP'; end if;
 if (select count(*) from public.reelready_jobs where not is_demo and provider_request_id='native' and status in ('processing','scheduled','submitting'))>=p_global_limit then raise exception 'PUBLICATION_QUEUE_CAP'; end if;
 update public.reelready_jobs set status=case when scheduled_at>now() then 'scheduled' else 'processing' end,provider_request_id='native',worker_pool=p_pool,next_attempt_at=coalesce(scheduled_at,now()),updated_at=now() where id=p_job and owner_id=p_owner and status='pending' and not is_demo;
 admitted:=found;
 if admitted then
  update public.reelready_targets t set status=case when j.scheduled_at>now() then 'scheduled' else 'processing' end,safe_message=case when j.scheduled_at>now() then 'Scheduled in ReelReady. Awaiting delivery at your chosen time.' else 'Queued for direct platform delivery.' end from public.reelready_jobs j where t.job_id=p_job and t.owner_id=p_owner and j.id=t.job_id and t.status in ('pending','failed');
 end if;
 return admitted;
end;$$;
-- Refresh-token rotation is serialized across server instances and the worker.
alter table public.reelready_social_credentials add column refresh_lease uuid, add column refresh_until timestamptz;
