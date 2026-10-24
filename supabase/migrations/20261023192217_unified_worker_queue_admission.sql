-- One global admission lock and combined media/publication counts preserve existing caps.
create or replace function public.reelready_enqueue_media_job(p_owner uuid,p_reel uuid,p_source uuid,p_kind text,p_fingerprint text,p_payload jsonb,p_retry boolean,p_user_cap integer,p_global_cap integer,p_pool text)
returns setof public.reelready_media_jobs language plpgsql security invoker set search_path='' as $$
declare existing public.reelready_media_jobs;
begin
 perform pg_advisory_xact_lock(24629721);
 select * into existing from public.reelready_media_jobs where owner_id=p_owner and fingerprint=p_fingerprint;
 if found and (not p_retry or existing.status not in ('failed','cancelled')) then return next existing; return; end if;
 if ((select count(*) from public.reelready_media_jobs where owner_id=p_owner and status in ('queued','running'))+(select count(*) from public.reelready_jobs where owner_id=p_owner and not is_demo and provider_request_id='native' and status in ('processing','scheduled','submitting'))) >= greatest(1,p_user_cap) then raise exception 'USER_QUEUE_FULL'; end if;
 if ((select count(*) from public.reelready_media_jobs where status in ('queued','running'))+(select count(*) from public.reelready_jobs where not is_demo and provider_request_id='native' and status in ('processing','scheduled','submitting'))) >= greatest(1,p_global_cap) then raise exception 'GLOBAL_QUEUE_FULL'; end if;
 if existing.id is not null then
  return query update public.reelready_media_jobs set status='queued',stage='Waiting for media worker',safe_error=null,result=null,created_at=now(),updated_at=now() where id=existing.id returning *;
 else
  return query insert into public.reelready_media_jobs(owner_id,reel_id,source_id,kind,fingerprint,payload,pool) values(p_owner,p_reel,p_source,p_kind,p_fingerprint,p_payload,p_pool) returning *;
 end if;
end;$$;

create or replace function public.reelready_queue_publication(p_job uuid,p_owner uuid,p_pool text,p_user_limit integer,p_global_limit integer) returns boolean language plpgsql security invoker set search_path='' as $$
declare admitted boolean;
begin
 perform pg_advisory_xact_lock(24629721);
 if ((select count(*) from public.reelready_jobs where not is_demo and provider_request_id='native' and status in ('processing','scheduled','submitting') and owner_id=p_owner)+(select count(*) from public.reelready_media_jobs where owner_id=p_owner and status in ('queued','running')))>=p_user_limit then raise exception 'PUBLICATION_USER_CAP'; end if;
 if ((select count(*) from public.reelready_jobs where not is_demo and provider_request_id='native' and status in ('processing','scheduled','submitting'))+(select count(*) from public.reelready_media_jobs where status in ('queued','running')))>=p_global_limit then raise exception 'PUBLICATION_QUEUE_CAP'; end if;
 update public.reelready_jobs set status=case when scheduled_at>now() then 'scheduled' else 'processing' end,provider_request_id='native',worker_pool=p_pool,next_attempt_at=coalesce(scheduled_at,now()),updated_at=now() where id=p_job and owner_id=p_owner and status='pending' and not is_demo;
 admitted:=found;
 if admitted then
  update public.reelready_targets t set status=case when j.scheduled_at>now() then 'scheduled' else 'processing' end,safe_message=case when j.scheduled_at>now() then 'Scheduled in ReelReady. Awaiting delivery at your chosen time.' else 'Queued for direct platform delivery.' end from public.reelready_jobs j where t.job_id=p_job and t.owner_id=p_owner and j.id=t.job_id and t.status in ('pending','failed');
 end if;
 return admitted;
end;$$;
