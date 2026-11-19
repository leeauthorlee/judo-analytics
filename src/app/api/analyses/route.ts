import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { enqueueAnalysisTask, isAnalysisQueueConfigured } from "@/lib/google/tasks";

export const runtime = "nodejs";

export async function POST(request: Request) {
  if (!isSupabaseConfigured()) return NextResponse.json({ error: "로그인 설정이 필요합니다." }, { status: 503 });
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  if (!isAnalysisQueueConfigured()) {
    return NextResponse.json({ error: "분석 워커 연결 설정이 필요합니다. 작업은 등록되지 않았습니다." }, { status: 503 });
  }
  let body;
  try { body = await request.json(); } catch {
    return NextResponse.json({ error: "잘못된 분석 요청입니다." }, { status: 400 });
  }
  if (!body || typeof body.videoId !== "string" || !/^[a-f0-9-]{36}$/i.test(body.videoId) ||
      !Number.isSafeInteger(body.startMs) || !Number.isSafeInteger(body.endMs) ||
      body.startMs < 0 || body.endMs <= body.startMs || body.endMs - body.startMs > 30_000 || body.endMs > 600_000) {
    return NextResponse.json({ error: "분석할 공격 구간을 30초 이내로 지정해 주세요." }, { status: 400 });
  }
  const thumbnailKey = typeof body.thumbnailKey === "string" &&
    body.thumbnailKey.startsWith(`workspaces/${user.id}/`) &&
    /^workspaces\/[a-f0-9-]{36}\/[a-f0-9-]{36}\.jpg$/i.test(body.thumbnailKey) ? body.thumbnailKey : null;
  const { data: video } = await supabase.from("video_assets").select("id,status,duration_ms")
    .eq("id", body.videoId).is("deleted_at", null).maybeSingle();
  if (!video || video.status === "deleted") return NextResponse.json({ error: "접근할 수 있는 영상이 없습니다." }, { status: 404 });
  if (video.duration_ms !== null && body.endMs > video.duration_ms) {
    return NextResponse.json({ error: "선택 구간이 영상 길이를 초과합니다." }, { status: 400 });
  }

  // Bound AI cost: at most 2 in-flight jobs and 20 requests per hour per actor.
  const [{ count: active }, { count: recent }] = await Promise.all([
    supabase.from("video_analyses").select("id", { count: "exact", head: true }).in("status", ["queued", "processing"]),
    supabase.from("video_analyses").select("id", { count: "exact", head: true })
      .gte("created_at", new Date(Date.now() - 60 * 60 * 1000).toISOString()),
  ]);
  if ((active ?? 0) >= 2) {
    return NextResponse.json({ error: "진행 중인 분석이 2건입니다. 완료 후 다시 시도해 주세요." }, { status: 429 });
  }
  if ((recent ?? 0) >= 20) {
    return NextResponse.json({ error: "시간당 분석 요청 한도를 초과했습니다." }, { status: 429 });
  }

  const { data: analysis, error } = await supabase.from("video_analyses")
    .insert({ video_id: video.id, status: "queued", input_json: { startMs: body.startMs, endMs: body.endMs, thumbnailKey } })
    .select("id,status,created_at").single();
  if (error || !analysis) return NextResponse.json({ error: "분석 작업을 등록하지 못했습니다. DB 마이그레이션을 확인해 주세요." }, { status: 500 });
  try {
    if (!await enqueueAnalysisTask(analysis.id)) throw new Error("Queue unavailable");
  } catch (cause) {
    console.error("ANALYSIS_DISPATCH_FAILED", analysis.id, cause);
    const { error: markError } = await supabase.rpc("fail_analysis_dispatch", { target_id: analysis.id });
    if (markError) console.error("ANALYSIS_DISPATCH_STATUS_FAILED", markError.code);
    return NextResponse.json({ error: "분석 작업 전송에 실패했습니다.", analysisId: analysis.id }, { status: 503 });
  }
  return NextResponse.json({ analysis: { ...analysis, dispatchStatus: "sent" } }, { status: 202 });
}
