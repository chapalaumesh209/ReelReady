-- Keep the public scanner as SECURITY INVOKER. The narrow auth lookup lives in
-- an unexposed schema and is executable only by the server role.
create schema if not exists reelready_private;
revoke all on schema reelready_private from public,anon,authenticated;
grant usage on schema reelready_private to service_role;
create function reelready_private.is_anonymous_owner(p_owner uuid) returns boolean language plpgsql stable security definer set search_path='' as $$
begin
 if coalesce(current_setting('request.jwt.claims',true)::jsonb->>'role','') <> 'service_role' then raise insufficient_privilege; end if;
 return exists(select 1 from auth.users where id=p_owner and is_anonymous=true);
end;$$;
revoke all on function reelready_private.is_anonymous_owner(uuid) from public,anon,authenticated;
grant execute on function reelready_private.is_anonymous_owner(uuid) to service_role;
create or replace function public.reelready_retention_candidates(p_before timestamptz) returns table(reel_id uuid,owner_id uuid) language sql security invoker set search_path='' as $$
 select r.id,r.owner_id from public.reelready_reels r
 where reelready_private.is_anonymous_owner(r.owner_id) and r.updated_at<p_before
 and not exists(select 1 from public.reelready_media_jobs m where m.reel_id=r.id and m.status in ('queued','running'))
 and not exists(select 1 from public.reelready_jobs j where j.reel_id=r.id and (j.status in ('pending','submitting','uncertain','processing','scheduled') or j.scheduled_at>now()));
$$;
revoke all on function public.reelready_retention_candidates(timestamptz) from public,anon,authenticated;
grant execute on function public.reelready_retention_candidates(timestamptz) to service_role;
