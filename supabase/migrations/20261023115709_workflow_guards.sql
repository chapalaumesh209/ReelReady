-- Compatible with an already initialized local development database.
alter table public.reelready_connections add column if not exists is_demo boolean not null default false;
alter table public.reelready_jobs drop constraint if exists reelready_jobs_status_check;
alter table public.reelready_jobs add constraint reelready_jobs_status_check check (status in ('pending','submitting','uncertain','processing','scheduled','published','failed','demo'));
