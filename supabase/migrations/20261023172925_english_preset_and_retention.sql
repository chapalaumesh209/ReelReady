alter table public.reelready_media_jobs drop constraint reelready_media_jobs_kind_check;
alter table public.reelready_media_jobs add constraint reelready_media_jobs_kind_check check(kind in ('analyze','transcribe','suggest','translate','preview','generate','render','english'));
-- Cleanup candidates are anonymous, expired reels with no in-flight processing or future/uncertain publication.
create function public.reelready_retention_candidates(p_before timestamptz) returns table(reel_id uuid,owner_id uuid) language sql security invoker set search_path='' as $$
 select r.id,r.owner_id from public.reelready_reels r join auth.users u on u.id=r.owner_id
 where u.is_anonymous=true and r.updated_at<p_before
 and not exists(select 1 from public.reelready_media_jobs m where m.reel_id=r.id and m.status in ('queued','running'))
 and not exists(select 1 from public.reelready_jobs j where j.reel_id=r.id and (j.status in ('pending','submitting','uncertain','processing','scheduled') or j.scheduled_at>now()));
$$;
revoke all on function public.reelready_retention_candidates(timestamptz) from public,anon,authenticated;
grant execute on function public.reelready_retention_candidates(timestamptz) to service_role;
