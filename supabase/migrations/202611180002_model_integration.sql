-- Selection input and manual review are separate from immutable model output.
alter table public.video_analyses add column input_json jsonb not null default '{}'::jsonb;
alter table public.diary_entries add column source_analysis_id uuid unique references public.video_analyses(id) on delete set null;

insert into public.techniques (id,name_ko,name_en) values
  ('ippon_seoi_nage','한팔업어치기','Ippon-seoi-nage'), ('o_goshi','허리껴치기','O-goshi'),
  ('osoto_gari','밭다리후리기','O-soto-gari'), ('uchi_mata','허벅다리걸기','Uchi-mata')
on conflict (id) do nothing;
insert into public.model_versions (purpose,model_name,version,status) values
  ('technique','r3d18','frozen_r3d18_kinetics400_linear_v1','candidate')
on conflict (purpose,model_name,version) do nothing;
insert into public.rulesets (name,version) values ('사용자 확인 등 접촉 기준','service_landing_v1')
on conflict (name,version) do nothing;

create table public.analysis_reviews (
  analysis_id uuid primary key references public.video_analyses(id) on delete cascade,
  reviewer_user_id uuid not null references auth.users(id) on delete cascade,
  technique_label text not null check (technique_label in ('ippon_seoi_nage','o_goshi','osoto_gari','uchi_mata','unsupported','unknown')),
  landing_choice text not null check (landing_choice in ('full','partial','none','unknown')),
  service_score text generated always as (case landing_choice
    when 'full' then 'ippon' when 'partial' then 'waza_ari' when 'none' then 'no_score' else 'undetermined' end) stored,
  updated_at timestamptz not null default now()
);
alter table public.analysis_reviews enable row level security;
create policy "read own analysis reviews" on public.analysis_reviews for select to authenticated using (
  exists (select 1 from public.video_analyses a where a.id=analysis_id and public.owns_video(a.video_id))
);
create policy "insert own analysis reviews" on public.analysis_reviews for insert to authenticated with check (
  reviewer_user_id=(select auth.uid()) and exists (
    select 1 from public.video_analyses a where a.id=analysis_id and public.owns_video(a.video_id)
    and a.status in ('review_required','completed') and a.result_json->>'provider'='local-r3d18')
);
create policy "update own analysis reviews" on public.analysis_reviews for update to authenticated
using (reviewer_user_id=(select auth.uid()) and exists (
  select 1 from public.video_analyses a where a.id=analysis_id and public.owns_video(a.video_id)))
with check (reviewer_user_id=(select auth.uid()) and exists (
  select 1 from public.video_analyses a where a.id=analysis_id and public.owns_video(a.video_id)
  and a.status in ('review_required','completed') and a.result_json->>'provider'='local-r3d18'));
grant select,insert,update on public.analysis_reviews to authenticated;
grant all on public.analysis_reviews to service_role;

create function public.fail_analysis_dispatch(target_id uuid) returns void
language sql security definer set search_path='' as $$
  update public.video_analyses set status='failed',error_code='DISPATCH_FAILED',completed_at=now()
  where id=target_id and status='queued' and public.owns_video(video_id);
$$;
revoke all on function public.fail_analysis_dispatch(uuid) from public;
grant execute on function public.fail_analysis_dispatch(uuid) to authenticated;

-- One transaction: event, non-scoring assessment, real-result diary and job status.
-- Only the private worker may invoke this function; the experimental model stays candidate.
create function public.complete_judo_analysis(target_id uuid, expected_attempt integer, model_result jsonb) returns void
language plpgsql security invoker set search_path='' as $$
declare
  job public.video_analyses%rowtype;
  asset public.video_assets%rowtype;
  event jsonb;
  event_id uuid;
  highlight_id uuid;
  diary_id uuid;
  model_id uuid;
  rule_id uuid;
  technique_name text;
begin
  select * into job from public.video_analyses where id=target_id for update;
  if not found then raise exception 'Analysis missing'; end if;
  if job.status in ('completed','review_required') then return; end if;
  if job.status <> 'processing' or job.attempts <> expected_attempt then raise exception 'Stale analysis attempt'; end if;
  if model_result->>'provider' <> 'local-r3d18' or jsonb_array_length(model_result->'events') <> 1 then
    raise exception 'Unsupported model result';
  end if;
  select * into asset from public.video_assets where id=job.video_id and deleted_at is null;
  if not found then raise exception 'Video missing'; end if;
  select id into model_id from public.model_versions where purpose='technique' and model_name='r3d18'
    and version=model_result->>'providerVersion';
  if model_id is null then raise exception 'Model version missing'; end if;
  select id into rule_id from public.rulesets where name='사용자 확인 등 접촉 기준' and version='service_landing_v1';
  event := model_result->'events'->0;
  select name_ko into technique_name from public.techniques where id=event->>'techniqueId';
  insert into public.analysis_events (analysis_id,technique_id,start_ms,end_ms,observations,missing_evidence)
    values (job.id,event->>'techniqueId',(event->>'startMs')::integer,(event->>'endMs')::integer,
      event->'observations',event->'missingEvidence') returning id into event_id;
  insert into public.event_assessments (event_id,ruleset_id,assessment_source,score_label,confidence_band,evidence_json)
    values (event_id,rule_id,'model','uncertain','low',jsonb_build_object('serviceScore','unreviewed','techniqueCandidates',event->'techniqueCandidates'));
  insert into public.highlights (video_id,event_id,start_ms,end_ms,title,note,thumbnail_key)
    values (asset.id,event_id,(event->>'startMs')::integer,(event->>'endMs')::integer,
      technique_name || ' 후보','AI 기술 추천 · 착지 미확인',
      case when starts_with(job.input_json->>'thumbnailKey', 'workspaces/' || split_part(asset.storage_key,'/',2) || '/')
        then job.input_json->>'thumbnailKey' else null end) returning id into highlight_id;
  insert into public.diary_entries (workspace_id,entry_date,title,note,source_analysis_id)
    values (asset.workspace_id,(now() at time zone 'Asia/Seoul')::date,asset.original_name || ' 분석 결과',
      'AI 기술 후보: ' || technique_name || E'\n착지·득점: 사용자 확인 전\n실험 모델 추천이며 공식 판정이 아닙니다.',job.id)
    returning id into diary_id;
  insert into public.diary_entry_highlights (highlight_id,diary_entry_id) values (highlight_id,diary_id);
  update public.video_analyses set status='review_required',error_code=null,completed_at=now(),
    model_version_id=model_id,ruleset_id=rule_id,
    result_json=jsonb_set(model_result,'{events}',jsonb_build_array(event || jsonb_build_object('eventId',event_id)))
    where id=job.id;
end;
$$;
revoke all on function public.complete_judo_analysis(uuid,integer,jsonb) from public,anon,authenticated;
grant execute on function public.complete_judo_analysis(uuid,integer,jsonb) to service_role;

create function public.sync_user_review_diary() returns trigger
language plpgsql security invoker set search_path='' as $$
declare reviewed_name text; predicted_name text; score_name text;
begin
  select name_ko into reviewed_name from public.techniques where id=new.technique_label;
  reviewed_name := coalesce(reviewed_name,case when new.technique_label='unsupported' then '지원 외 기술' else '확인 불가' end);
  select t.name_ko into predicted_name from public.video_analyses a
    left join public.techniques t on t.id=a.result_json->'events'->0->>'techniqueId' where a.id=new.analysis_id;
  score_name := case new.service_score when 'ippon' then '한판' when 'waza_ari' then '절반' when 'no_score' then '무득점' else '판단 불가' end;
  update public.diary_entries set note='AI 기술 후보: ' || coalesce(predicted_name,'확인 불가') ||
    E'\n사용자 확인 기술: ' || reviewed_name || E'\n사용자 확인 득점: ' || score_name ||
    E'\n등 접촉 기준의 사용자 기록이며 공식 판정이 아닙니다.' where source_analysis_id=new.analysis_id;
  return new;
end;
$$;
create trigger analysis_review_updates_diary after insert or update on public.analysis_reviews
  for each row execute function public.sync_user_review_diary();
