import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { enqueueAnalysisTask } from "@/lib/google/tasks";

export const runtime = "nodejs";

export async function POST(request: Request) {
  if (!isSupabaseConfigured()) {
    return NextResponse.json({ error: "Supabase 로그인이 설정되지 않았습니다." }, { status: 503 });
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });

  let body: { videoId?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "잘못된 분석 요청입니다." }, { status: 400 });
  }
  if (typeof body.videoId !== "string" || !/^[a-f0-9-]{36}$/i.test(body.videoId)) {
    return NextResponse.json({ error: "영상 ID가 올바르지 않습니다." }, { status: 400 });
  }

  const { data: video } = await supabase
    .from("video_assets")
    .select("id,status")
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

  try {
    const dispatched = await enqueueAnalysisTask(analysis.id);
    if (!dispatched) {
      await supabase.from("video_analyses").update({ error_code: "WORKER_NOT_CONFIGURED" }).eq("id", analysis.id);
    }
    return NextResponse.json({
      analysis: { ...analysis, dispatchStatus: dispatched ? "sent" : "worker_not_configured" },
    }, { status: 202 });
  } catch {
    await supabase.from("video_analyses").update({ status: "failed", error_code: "TASK_ENQUEUE_FAILED" }).eq("id", analysis.id);
    return NextResponse.json({
      analysis: { ...analysis, status: "failed", errorCode: "TASK_ENQUEUE_FAILED" },
      error: "분석 서버에 작업을 전달하지 못했습니다.",
    }, { status: 502 });
  }
}
