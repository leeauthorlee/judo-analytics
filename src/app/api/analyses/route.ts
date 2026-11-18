import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { enqueueAnalysisTask } from "@/lib/google/tasks";

export const runtime = "nodejs";

const TEMPORARY_RESULT = {
  provider: "unavailable",
  providerVersion: "offline",
  rulesetId: "ruleset_unknown",
  disclaimer: "분석 모델이 연결되지 않아 판단 불가로 표시합니다. 공식 판정이 아닙니다.",
  events: [
    {
      startMs: 0,
      endMs: 1000,
      techniqueId: null,
      score: "uncertain" as const,
      toriRole: "unknown" as const,
      ukeRole: "unknown" as const,
      observations: ["분석 모델이 연결되지 않아 기술과 점수를 판단할 수 없습니다."],
      missingEvidence: ["모델 추론 결과", "관절 시계열"],
      confidenceBand: "low" as const,
    },
  ],
};

export async function POST(request: Request) {
  if (!isSupabaseConfigured()) {
    return NextResponse.json({ error: "Supabase 로그인이 설정되지 않았습니다." }, { status: 503 });
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });

  let body: { videoId?: unknown; thumbnailKey?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "잘못된 분석 요청입니다." }, { status: 400 });
  }
  if (typeof body.videoId !== "string" || !/^[a-f0-9-]{36}$/i.test(body.videoId)) {
    return NextResponse.json({ error: "영상 ID가 올바르지 않습니다." }, { status: 400 });
  }
  const thumbnailKey =
    typeof body.thumbnailKey === "string" && /^workspaces\/[a-f0-9-]{36}\/[a-f0-9-]{36}\.jpg$/i.test(body.thumbnailKey)
      ? body.thumbnailKey
      : null;

  const { data: video } = await supabase
    .from("video_assets")
    .select("id,workspace_id,original_name,status")
    .eq("id", body.videoId)
    .maybeSingle();
  if (!video || video.status === "deleted") {
    return NextResponse.json({ error: "접근할 수 있는 영상을 찾을 수 없습니다." }, { status: 404 });
  }

  const { data: analysis, error } = await supabase
    .from("video_analyses")
    .insert({ video_id: video.id, status: "queued" })
    .select("id,status,created_at")
    .single();
  if (error || !analysis) {
    return NextResponse.json({ error: "분석 작업을 등록하지 못했습니다." }, { status: 500 });
  }

  // 모델이 없어도 판단 불가 결과를 만들고, 썸네일·점수와 함께 일기에 자동 저장합니다.
  const { data: highlight } = await supabase
    .from("highlights")
    .insert({
      video_id: video.id,
      event_id: null,
      start_ms: 0,
      end_ms: 1000,
      title: "판단 불가",
      note: "점수: 불확실 · 분석 모델 미연결",
      thumbnail_key: thumbnailKey,
    })
    .select("id")
    .single();

  let diaryId: string | null = null;
  const { data: diary } = await supabase
    .from("diary_entries")
    .insert({
      workspace_id: video.workspace_id,
      entry_date: new Date().toISOString().slice(0, 10),
      title: `${video.original_name} 분석 결과`,
      note: "판정 결과: 판단 불가\n점수: 불확실\n근거: 분석 모델이 연결되지 않아 판정할 수 없습니다.",
    })
    .select("id")
    .single();
  diaryId = diary?.id ?? null;

  if (highlight && diaryId) {
    await supabase
      .from("diary_entry_highlights")
      .insert({ highlight_id: highlight.id, diary_entry_id: diaryId, sort_order: 0 });
  }

  let dispatchStatus = "worker_not_configured";
  try {
    dispatchStatus = (await enqueueAnalysisTask(analysis.id)) ? "sent" : "worker_not_configured";
  } catch {
    dispatchStatus = "worker_not_configured";
  }

  return NextResponse.json(
    {
      analysis: { ...analysis, dispatchStatus },
      result: TEMPORARY_RESULT,
      autoSavedDiaryId: diaryId,
    },
    { status: 202 },
  );
}
