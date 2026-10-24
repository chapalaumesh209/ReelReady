-- Only one unresolved job for a reel/mode, even across concurrent serverless requests.
create unique index reelready_jobs_one_active on public.reelready_jobs(owner_id,reel_id,is_demo) where status in ('pending','submitting','uncertain','processing','scheduled');
-- Job and targets are one transaction. No partially prepared job can be claimed.
create function public.reelready_prepare_job(p_job jsonb,p_targets jsonb) returns uuid language plpgsql security invoker set search_path='' as $$
declare result uuid;
begin
 insert into public.reelready_jobs(id,owner_id,reel_id,idempotency_key,is_demo,status,scheduled_at,provider_request_id,payload)
 values((p_job->>'id')::uuid,(p_job->>'owner_id')::uuid,(p_job->>'reel_id')::uuid,p_job->>'idempotency_key',(p_job->>'is_demo')::boolean,'pending',(p_job->>'scheduled_at')::timestamptz,p_job->>'id',p_job->'payload')
 on conflict(owner_id,idempotency_key) do nothing returning id into result;
 if result is null then
 select id into result from public.reelready_jobs where owner_id=(p_job->>'owner_id')::uuid and idempotency_key=p_job->>'idempotency_key';
 return result;
 end if;
 insert into public.reelready_targets(job_id,owner_id,platform,caption,status)
 select result,(p_job->>'owner_id')::uuid,t.platform,t.caption,'pending' from jsonb_to_recordset(p_targets) as t(platform text,caption text);
 return result;
end;$$;
revoke all on function public.reelready_prepare_job(jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.reelready_prepare_job(jsonb,jsonb) to service_role;
