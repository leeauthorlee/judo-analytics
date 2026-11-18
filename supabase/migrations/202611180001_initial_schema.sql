create extension if not exists pgcrypto;

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  role text not null default 'member' check (role in ('member', 'analyst')),
  created_at timestamptz not null default now()
);
create table public.workspaces (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);
create table public.rulesets (
  id uuid primary key default gen_random_uuid(), name text not null, version text not null,
  source_url text, effective_from date, effective_to date, created_at timestamptz not null default now(),
  unique (name, version)
);
create table public.techniques (
  id text primary key, name_ko text not null, name_en text, category text, is_active boolean not null default true
);
create table public.video_assets (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  storage_key text not null unique, original_name text not null, source_type text not null default 'user_upload',
  source_reference text, content_type text not null default 'video/mp4' check (content_type = 'video/mp4'),
  size_bytes bigint not null check (size_bytes > 0 and size_bytes <= 524288000),
  duration_ms integer check (duration_ms is null or duration_ms > 0),
  width integer check (width is null or width > 0), height integer check (height is null or height > 0),
  frame_rate real check (frame_rate is null or frame_rate > 0), video_codec text, container text,
  status text not null default 'uploaded' check (status in ('uploaded', 'processing', 'ready', 'failed', 'deleted')),
  created_at timestamptz not null default now(), deleted_at timestamptz,
  check (storage_key like 'workspaces/%')
);
create table public.video_rights (
  id uuid primary key default gen_random_uuid(), video_id uuid not null references public.video_assets(id) on delete cascade,
  checked_by_user_id uuid references auth.users(id) on delete set null, rights_holder text, license_reference text,
  territory text, allowed_training boolean not null default false,
  allowed_cloud_processing boolean not null default false,
  clearance_status text not null default 'pending' check (clearance_status in ('pending', 'approved', 'denied', 'expired')),
  valid_until timestamptz, created_at timestamptz not null default now()
);
create table public.model_versions (
  id uuid primary key default gen_random_uuid(), training_run_id uuid,
  purpose text not null, model_name text not null, version text not null, artifact_uri text,
  status text not null default 'candidate' check (status in ('candidate', 'validated', 'active', 'retired')),
  created_at timestamptz not null default now(), unique (purpose, model_name, version)
);
create table public.video_analyses (
  id uuid primary key default gen_random_uuid(), video_id uuid not null references public.video_assets(id) on delete cascade,
  model_version_id uuid references public.model_versions(id) on delete set null,
  ruleset_id uuid references public.rulesets(id) on delete set null,
  status text not null default 'queued' check (status in ('queued', 'processing', 'review_required', 'completed', 'failed')),
  error_code text, result_json jsonb, attempts integer not null default 0 check (attempts >= 0),
  started_at timestamptz, completed_at timestamptz, created_at timestamptz not null default now()
);
create table public.analysis_events (
  id uuid primary key default gen_random_uuid(), analysis_id uuid not null references public.video_analyses(id) on delete cascade,
  technique_id text references public.techniques(id) on delete set null,
  tori_role text not null default 'unknown' check (tori_role in ('blue', 'white', 'unknown')),
  uke_role text not null default 'unknown' check (uke_role in ('blue', 'white', 'unknown')),
  start_ms integer not null check (start_ms >= 0), end_ms integer not null check (end_ms > start_ms),
  detection_confidence real check (detection_confidence is null or detection_confidence between 0 and 1),
  observations jsonb not null default '[]'::jsonb, missing_evidence jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);
create table public.event_assessments (
  id uuid primary key default gen_random_uuid(), event_id uuid not null references public.analysis_events(id) on delete cascade,
  ruleset_id uuid references public.rulesets(id) on delete set null,
  reviewer_user_id uuid references auth.users(id) on delete set null,
  assessment_source text not null check (assessment_source in ('model', 'official_record', 'expert_review')),
  score_label text not null check (score_label in ('ippon', 'waza_ari', 'yuko', 'no_score', 'uncertain')),
  confidence_band text check (confidence_band is null or confidence_band in ('low', 'medium', 'high')),
  evidence_json jsonb not null default '{}'::jsonb,
  review_status text not null default 'pending' check (review_status in ('pending', 'approved', 'corrected', 'rejected')),
  created_at timestamptz not null default now()
);
create table public.highlights (
  id uuid primary key default gen_random_uuid(), video_id uuid not null references public.video_assets(id) on delete cascade,
  event_id uuid references public.analysis_events(id) on delete set null,
  start_ms integer not null check (start_ms >= 0), end_ms integer not null check (end_ms > start_ms),
  title text not null, note text, thumbnail_key text, created_at timestamptz not null default now()
);
create table public.diary_entries (
  id uuid primary key default gen_random_uuid(), workspace_id uuid not null references public.workspaces(id) on delete cascade,
  entry_date date not null, title text not null, note text, created_at timestamptz not null default now()
);
create table public.diary_entry_highlights (
  highlight_id uuid primary key references public.highlights(id) on delete cascade,
  diary_entry_id uuid not null references public.diary_entries(id) on delete cascade,
  sort_order integer not null default 0
);
create table public.training_datasets (
  id uuid primary key default gen_random_uuid(), ruleset_id uuid references public.rulesets(id) on delete set null,
  name text not null, version text not null,
  status text not null default 'draft' check (status in ('draft', 'frozen', 'retired')),
  created_at timestamptz not null default now(), unique (name, version)
);
create table public.dataset_samples (
  id uuid primary key default gen_random_uuid(), dataset_id uuid not null references public.training_datasets(id) on delete cascade,
  video_id uuid not null references public.video_assets(id) on delete cascade,
  rights_id uuid references public.video_rights(id) on delete set null,
  start_ms integer not null check (start_ms >= 0), end_ms integer not null check (end_ms > start_ms),
  split text not null check (split in ('train', 'validation', 'test')),
  review_status text not null default 'pending' check (review_status in ('pending', 'approved', 'rejected'))
);
create table public.training_labels (
  id uuid primary key default gen_random_uuid(), sample_id uuid not null references public.dataset_samples(id) on delete cascade,
  technique_id text references public.techniques(id) on delete set null,
  ruleset_id uuid references public.rulesets(id) on delete set null,
  event_start_ms integer not null check (event_start_ms >= 0), event_end_ms integer not null check (event_end_ms > event_start_ms),
  target_type text not null check (target_type in ('technique', 'score')),
  score_label text check (score_label is null or score_label in ('ippon', 'waza_ari', 'yuko', 'no_score', 'uncertain')),
  label_source text not null check (label_source in ('expert', 'official_record', 'commentary_candidate', 'title_candidate')),
  reviewer_user_id uuid references auth.users(id) on delete set null,
  review_status text not null default 'pending' check (review_status in ('pending', 'approved', 'rejected')),
  created_at timestamptz not null default now()
);
create table public.training_runs (
  id uuid primary key default gen_random_uuid(), dataset_id uuid not null references public.training_datasets(id) on delete restrict,
  base_model_version_id uuid references public.model_versions(id) on delete set null,
  code_revision text, parameters_json jsonb not null default '{}'::jsonb, metrics_json jsonb not null default '{}'::jsonb,
  status text not null default 'queued' check (status in ('queued', 'running', 'completed', 'failed')),
  started_at timestamptz, completed_at timestamptz, created_at timestamptz not null default now()
);
alter table public.model_versions add constraint model_versions_training_run_fk
  foreign key (training_run_id) references public.training_runs(id) on delete set null;

create or replace function public.create_user_workspace() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name'))
  on conflict (id) do nothing;
  insert into public.workspaces (user_id) values (new.id) on conflict (user_id) do nothing;
  return new;
end;
$$;
create trigger on_auth_user_created after insert on auth.users
  for each row execute procedure public.create_user_workspace();

create or replace function public.validate_training_sample_rights() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.rights_id is null or not exists (
    select 1 from public.video_rights r
    where r.id = new.rights_id
      and r.video_id = new.video_id
      and r.clearance_status = 'approved'
      and r.allowed_training = true
      and (r.valid_until is null or r.valid_until > now())
  ) then
    raise exception 'A current approved training right is required for every dataset sample';
  end if;
  return new;
end;
$$;
create trigger dataset_sample_requires_training_rights
  before insert or update on public.dataset_samples
  for each row execute procedure public.validate_training_sample_rights();

create or replace function public.owns_workspace(target_workspace_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.workspaces w where w.id = target_workspace_id and w.user_id = (select auth.uid()));
$$;
create or replace function public.owns_video(target_video_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.video_assets v join public.workspaces w on w.id = v.workspace_id
    where v.id = target_video_id and w.user_id = (select auth.uid()) and v.deleted_at is null
  );
$$;
create or replace function public.is_analyst() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.role = 'analyst');
$$;
revoke all on function public.owns_workspace(uuid), public.owns_video(uuid), public.is_analyst() from public;
grant execute on function public.owns_workspace(uuid), public.owns_video(uuid), public.is_analyst() to authenticated;

alter table public.profiles enable row level security;
alter table public.workspaces enable row level security;
alter table public.rulesets enable row level security;
alter table public.techniques enable row level security;
alter table public.video_assets enable row level security;
alter table public.video_rights enable row level security;
alter table public.model_versions enable row level security;
alter table public.video_analyses enable row level security;
alter table public.analysis_events enable row level security;
alter table public.event_assessments enable row level security;
alter table public.highlights enable row level security;
alter table public.diary_entries enable row level security;
alter table public.diary_entry_highlights enable row level security;
alter table public.training_datasets enable row level security;
alter table public.dataset_samples enable row level security;
alter table public.training_labels enable row level security;
alter table public.training_runs enable row level security;

create policy "read own profile" on public.profiles for select to authenticated using (id = (select auth.uid()));
create policy "read own workspace" on public.workspaces for select to authenticated using (user_id = (select auth.uid()));
create policy "read rulesets" on public.rulesets for select to authenticated using (true);
create policy "read techniques" on public.techniques for select to authenticated using (true);
create policy "read own videos" on public.video_assets for select to authenticated using (public.owns_workspace(workspace_id));
create policy "insert own videos" on public.video_assets for insert to authenticated with check (public.owns_workspace(workspace_id));
create policy "update own videos" on public.video_assets for update to authenticated using (public.owns_workspace(workspace_id)) with check (public.owns_workspace(workspace_id));
create policy "delete own videos" on public.video_assets for delete to authenticated using (public.owns_workspace(workspace_id));
create policy "read own rights" on public.video_rights for select to authenticated using (public.owns_video(video_id));
create policy "analysts manage rights" on public.video_rights for all to authenticated using (public.is_analyst()) with check (public.is_analyst());
create policy "read own models" on public.model_versions for select to authenticated using (status = 'active' or public.is_analyst());
create policy "read own analyses" on public.video_analyses for select to authenticated using (public.owns_video(video_id));
create policy "create own analyses" on public.video_analyses for insert to authenticated with check (public.owns_video(video_id));
create policy "read own events" on public.analysis_events for select to authenticated using (
  exists (select 1 from public.video_analyses a where a.id = analysis_id and public.owns_video(a.video_id))
);
create policy "read own assessments" on public.event_assessments for select to authenticated using (
  exists (select 1 from public.analysis_events e join public.video_analyses a on a.id = e.analysis_id
    where e.id = event_id and public.owns_video(a.video_id))
);
create policy "analysts manage assessments" on public.event_assessments for all to authenticated using (public.is_analyst()) with check (public.is_analyst());
create policy "read own highlights" on public.highlights for select to authenticated using (public.owns_video(video_id));
create policy "create own highlights" on public.highlights for insert to authenticated with check (public.owns_video(video_id));
create policy "update own highlights" on public.highlights for update to authenticated using (public.owns_video(video_id)) with check (public.owns_video(video_id));
create policy "delete own highlights" on public.highlights for delete to authenticated using (public.owns_video(video_id));
create policy "read own diaries" on public.diary_entries for select to authenticated using (public.owns_workspace(workspace_id));
create policy "create own diaries" on public.diary_entries for insert to authenticated with check (public.owns_workspace(workspace_id));
create policy "update own diaries" on public.diary_entries for update to authenticated using (public.owns_workspace(workspace_id)) with check (public.owns_workspace(workspace_id));
create policy "delete own diaries" on public.diary_entries for delete to authenticated using (public.owns_workspace(workspace_id));
create policy "manage own diary highlights" on public.diary_entry_highlights for all to authenticated using (
  exists (select 1 from public.diary_entries d where d.id = diary_entry_id and public.owns_workspace(d.workspace_id))
) with check (
  exists (select 1 from public.diary_entries d where d.id = diary_entry_id and public.owns_workspace(d.workspace_id))
  and exists (select 1 from public.highlights h where h.id = highlight_id and public.owns_video(h.video_id))
);
create policy "analysts read datasets" on public.training_datasets for select to authenticated using (public.is_analyst());
create policy "analysts manage datasets" on public.training_datasets for all to authenticated using (public.is_analyst()) with check (public.is_analyst());
create policy "analysts manage samples" on public.dataset_samples for all to authenticated using (public.is_analyst()) with check (public.is_analyst());
create policy "analysts manage labels" on public.training_labels for all to authenticated using (public.is_analyst()) with check (public.is_analyst());
create policy "analysts manage training runs" on public.training_runs for all to authenticated using (public.is_analyst()) with check (public.is_analyst());
create policy "analysts manage model versions" on public.model_versions for all to authenticated using (public.is_analyst()) with check (public.is_analyst());

grant select on all tables in schema public to authenticated;
grant insert, update, delete on public.video_assets, public.highlights, public.diary_entries, public.diary_entry_highlights to authenticated;
grant insert on public.video_analyses to authenticated;
grant insert, update, delete on public.event_assessments to authenticated;
grant insert, update, delete on public.video_rights, public.training_datasets, public.dataset_samples,
  public.training_labels, public.training_runs, public.model_versions to authenticated;

create index video_assets_workspace_created_idx on public.video_assets (workspace_id, created_at desc) where deleted_at is null;
create index video_analyses_video_created_idx on public.video_analyses (video_id, created_at desc);
create index analysis_events_analysis_time_idx on public.analysis_events (analysis_id, start_ms);
create index diary_entries_workspace_date_idx on public.diary_entries (workspace_id, entry_date desc);
create index dataset_samples_dataset_split_idx on public.dataset_samples (dataset_id, split);
