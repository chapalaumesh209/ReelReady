-- Additive retry support for n8n-managed provider requests. Successful receipts,
-- native checkpoints, legacy rows and source media remain untouched.
create or replace function public.reelready_retry_publication(
 p_job uuid,p_owner uuid,p_pool text,p_user_limit integer,p_global_limit integer,p_states jsonb
) returns boolean language plpgsql security invoker set search_path='' as $$
begin
 perform pg_advisory_xact_lock(24629721);
 update public.reelready_jobs
 set status='pending',scheduled_at=null,
     provider_job_id=case when payload->>'publishingProvider'='uploadpost' then null else provider_job_id end
 where id=p_job and owner_id=p_owner and status='failed'
   and provider_request_id='native' and not is_demo;
 if not found then return false; end if;
 update public.reelready_targets set native_state=p_states->>platform
 where job_id=p_job and owner_id=p_owner and status='failed' and p_states ? platform;
 return public.reelready_queue_publication(p_job,p_owner,p_pool,p_user_limit,p_global_limit);
end;$$;
revoke all on function public.reelready_retry_publication(uuid,uuid,text,integer,integer,jsonb) from public,anon,authenticated;
grant execute on function public.reelready_retry_publication(uuid,uuid,text,integer,integer,jsonb) to service_role;
