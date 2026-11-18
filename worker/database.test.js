import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { mapPrediction, MODEL_VERSION } from "./analysis-provider.js";

test("model persistence is atomic, idempotent and owner-scoped; reviews preserve AI output", async () => {
  const db = new PGlite();
  try {
    await db.exec(`create role authenticated; create role anon; create role service_role bypassrls;
      create schema auth;
      create table auth.users (id uuid primary key,raw_user_meta_data jsonb default '{}'::jsonb);
      create function auth.uid() returns uuid language sql stable as $$
        select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
      grant usage on schema auth to authenticated,service_role;
      grant usage on schema public to authenticated,service_role;`);
    const initial = await readFile(new URL("../supabase/migrations/202611180001_initial_schema.sql", import.meta.url), "utf8");
    // PGlite has gen_random_uuid built in; the optional pgcrypto extension is not bundled.
    await db.exec(initial.replace("create extension if not exists pgcrypto;", ""));
    await db.exec(await readFile(new URL("../supabase/migrations/202611180002_model_integration.sql", import.meta.url), "utf8"));
    await db.exec("grant all on all tables in schema public to service_role;");
    const owner = "10000000-0000-4000-8000-000000000001";
    const other = "10000000-0000-4000-8000-000000000002";
    await db.query("insert into auth.users(id) values ($1),($2)", [owner, other]);
    const { rows: [video] } = await db.query(`insert into public.video_assets(workspace_id,storage_key,original_name,size_bytes)
      select id,$1,'test.mp4',100 from public.workspaces where user_id=$2 returning id`, [`workspaces/${owner}/test.mp4`, owner]);
    const { rows: [job] } = await db.query(`insert into public.video_analyses(video_id,status,attempts,input_json)
      values ($1,'processing',1,'{"startMs":0,"endMs":1000}') returning id`, [video.id]);
    const result = mapPrediction({ model_version: MODEL_VERSION, status: "requires_user_review", service_score: "unreviewed",
      interval: { start: 0, end: 1 }, candidates: [{ technique: "o_goshi", model_score: 0.6 },
        { technique: "uchi_mata", model_score: 0.2 }, { technique: "osoto_gari", model_score: 0.1 }] }, 0, 1000);
    await db.exec("set role service_role");
    await db.query("select public.complete_judo_analysis($1,1,$2::jsonb)", [job.id, JSON.stringify(result)]);
    await db.query("select public.complete_judo_analysis($1,1,$2::jsonb)", [job.id, JSON.stringify(result)]);
    assert.equal((await db.query("select * from public.analysis_events")).rows.length, 1);
    assert.equal((await db.query("select * from public.diary_entries")).rows.length, 1);
    const saved = (await db.query("select result_json,status from public.video_analyses where id=$1", [job.id])).rows[0];
    assert.equal(saved.status, "review_required");
    assert.equal(saved.result_json.events[0].serviceScore, "unreviewed");
    assert.ok(saved.result_json.events[0].eventId);
    await db.exec("reset role; set role authenticated");
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [owner]);
    await db.query(`insert into public.analysis_reviews(analysis_id,reviewer_user_id,technique_label,landing_choice)
      values ($1,$2,'o_goshi','full')`, [job.id, owner]);
    assert.equal((await db.query("select service_score from public.analysis_reviews")).rows[0].service_score, "ippon");
    await db.query("update public.analysis_reviews set landing_choice='unknown' where analysis_id=$1", [job.id]);
    assert.equal((await db.query("select service_score from public.analysis_reviews")).rows[0].service_score, "undetermined");
    assert.match((await db.query("select note from public.diary_entries")).rows[0].note, /판단 불가/);
    assert.deepEqual((await db.query("select result_json from public.video_analyses where id=$1", [job.id])).rows[0].result_json, saved.result_json);
    await assert.rejects(db.query("select public.complete_judo_analysis($1,1,$2::jsonb)", [job.id, JSON.stringify(result)]));
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [other]);
    assert.equal((await db.query("select * from public.analysis_reviews")).rows.length, 0);
    assert.equal((await db.query("select * from public.video_analyses")).rows.length, 0);
    await assert.rejects(db.query(`insert into public.analysis_reviews(analysis_id,reviewer_user_id,technique_label,landing_choice)
      values ($1,$2,'o_goshi','none')`, [job.id, other]));
    await db.exec("reset role; set role service_role");
    const { rows: [badJob] } = await db.query("insert into public.video_analyses(video_id,status,attempts) values ($1,'processing',1) returning id", [video.id]);
    const broken = structuredClone(result); broken.events[0].techniqueId = "invalid";
    await assert.rejects(db.query("select public.complete_judo_analysis($1,1,$2::jsonb)", [badJob.id, JSON.stringify(broken)]));
    assert.equal((await db.query("select * from public.analysis_events where analysis_id=$1", [badJob.id])).rows.length, 0);
    assert.equal((await db.query("select status from public.video_analyses where id=$1", [badJob.id])).rows[0].status, "processing");
  } finally { await db.close(); }
});
