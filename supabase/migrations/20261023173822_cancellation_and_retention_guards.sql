-- The retention scanner needs auth metadata, but callers never receive auth rows.
-- Restrict the definer function to service_role rather than granting table access.
alter function public.reelready_retention_candidates(timestamptz) security definer;
revoke all on function public.reelready_retention_candidates(timestamptz) from public,anon,authenticated;
grant execute on function public.reelready_retention_candidates(timestamptz) to service_role;
revoke all on public.reelready_rate_limits from public,anon,authenticated;
-- Lock the lease while applying a result: cancellation and application are ordered atomically.
create function public.reelready_apply_audio_job(p_job uuid,p_lease uuid,p_updated timestamptz,p_changes jsonb) returns boolean language plpgsql security invoker set search_path='' as $$
declare j public.reelready_media_jobs; n integer;
begin
 select * into j from public.reelready_media_jobs where id=p_job for update;
 if not found or j.status<>'running' or j.lease_token is distinct from p_lease then return false; end if;
 update public.reelready_audio_edits set
 settings=case when p_changes ? 'settings' then p_changes->'settings' else settings end,
 transcript=case when p_changes ? 'transcript' then p_changes->>'transcript' else transcript end,
 script=case when p_changes ? 'script' then p_changes->>'script' else script end,
 classification=case when p_changes ? 'classification' then p_changes->>'classification' else classification end,
 segments=case when p_changes ? 'segments' then p_changes->'segments' else segments end,
 rendered_id=case when p_changes ? 'rendered_id' then (p_changes->>'rendered_id')::uuid else rendered_id end,
 approved_hash=case when p_changes ? 'approved_hash' then p_changes->>'approved_hash' else approved_hash end,
 updated_at=now()
 where reel_id=j.reel_id and owner_id=j.owner_id and source_id=j.source_id and updated_at=p_updated;
 get diagnostics n=row_count;
 return n=1;
end;$$;
revoke all on function public.reelready_apply_audio_job(uuid,uuid,timestamptz,jsonb) from public,anon,authenticated;
grant execute on function public.reelready_apply_audio_job(uuid,uuid,timestamptz,jsonb) to service_role;
