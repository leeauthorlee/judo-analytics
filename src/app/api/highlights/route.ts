import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/config";

export async function POST(request: Request) {
  if (!isSupabaseConfigured()) return NextResponse.json({ error: "서비스 설정이 필요합니다." }, { status: 503 });
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });

  let body: { videoId?: unknown; eventId?: unknown; startMs?: unknown; endMs?: unknown; title?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "잘못된 하이라이트 요청입니다." }, { status: 400 });
  }
  if (
    typeof body.videoId !== "string" || !/^[a-f0-9-]{36}$/i.test(body.videoId) ||
    typeof body.startMs !== "number" || !Number.isSafeInteger(body.startMs) || body.startMs < 0 ||
    typeof body.endMs !== "number" || !Number.isSafeInteger(body.endMs) || body.endMs <= body.startMs ||
    typeof body.title !== "string" || !body.title.trim() || body.title.length > 120 ||
    (body.eventId !== undefined && body.eventId !== null && (typeof body.eventId !== "string" || !/^[a-f0-9-]{36}$/i.test(body.eventId)))
  ) {
    return NextResponse.json({ error: "하이라이트 정보가 올바르지 않습니다." }, { status: 400 });
  }

  const { data: video } = await supabase.from("video_assets").select("id,duration_ms").eq("id", body.videoId).maybeSingle();
  if (!video || (video.duration_ms !== null && body.endMs > video.duration_ms)) {
    return NextResponse.json({ error: "접근할 수 있는 영상 구간이 아닙니다." }, { status: 404 });
  }

  let eventId: string | null = null;
  if (typeof body.eventId === "string") {
    const { data: event } = await supabase
      .from("analysis_events")
      .select("id,analysis_id,video_analyses!inner(video_id)")
      .eq("id", body.eventId)
      .maybeSingle();
    const relatedAnalysis = Array.isArray(event?.video_analyses) ? event.video_analyses[0] : event?.video_analyses;
    if (!event || relatedAnalysis?.video_id !== video.id) {
      return NextResponse.json({ error: "영상에 연결된 분석 이벤트를 찾을 수 없습니다." }, { status: 404 });
    }
    eventId = event.id;
  }

  const { data: highlight, error } = await supabase
    .from("highlights")
    .insert({
      video_id: video.id,
      event_id: eventId,
      start_ms: body.startMs,
      end_ms: body.endMs,
      title: body.title.trim(),
    })
    .select("id,video_id,event_id,start_ms,end_ms,title,created_at")
    .single();
  if (error || !highlight) return NextResponse.json({ error: "하이라이트를 저장하지 못했습니다." }, { status: 500 });
  return NextResponse.json({ highlight }, { status: 201 });
}
