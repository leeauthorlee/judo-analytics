import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/config";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  if (!isSupabaseConfigured()) return NextResponse.json({ error: "서비스 설정이 필요합니다." }, { status: 503 });
  const { id } = await context.params;
  if (!/^[a-f0-9-]{36}$/i.test(id)) return NextResponse.json({ error: "잘못된 분석 ID입니다." }, { status: 400 });

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });

  const { data, error } = await supabase
    .from("video_analyses")
    .select("id,status,error_code,result_json,created_at,completed_at,analysis_reviews(technique_label,landing_choice,service_score)")
    .eq("id", id)
    .maybeSingle();
  if (error || !data) return NextResponse.json({ error: "분석 작업을 찾을 수 없습니다." }, { status: 404 });
  return NextResponse.json({ analysis: data });
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  if (!isSupabaseConfigured()) return NextResponse.json({ error: "서비스 설정이 필요합니다." }, { status: 503 });
  const { id } = await context.params;
  if (!/^[a-f0-9-]{36}$/i.test(id)) return NextResponse.json({ error: "잘못된 분석 ID입니다." }, { status: 400 });
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  let body;
  try { body = await request.json(); } catch { return NextResponse.json({ error: "잘못된 확인 요청입니다." }, { status: 400 }); }
  if (!body || !["ippon_seoi_nage", "o_goshi", "osoto_gari", "uchi_mata", "unsupported", "unknown"].includes(body.technique) ||
      !["full", "partial", "none", "unknown"].includes(body.landing)) {
    return NextResponse.json({ error: "기술과 착지 유형을 선택해 주세요." }, { status: 400 });
  }
  const { data: analysis } = await supabase.from("video_analyses").select("id,status,result_json").eq("id", id).maybeSingle();
  if (!analysis) return NextResponse.json({ error: "분석을 찾을 수 없습니다." }, { status: 404 });
  if (!["review_required", "completed"].includes(analysis.status) || analysis.result_json?.provider !== "local-r3d18") {
    return NextResponse.json({ error: "모델 분석 완료 후 확인할 수 있습니다." }, { status: 409 });
  }
  const { data: review, error } = await supabase.from("analysis_reviews").upsert({
    analysis_id: id, reviewer_user_id: user.id, technique_label: body.technique,
    landing_choice: body.landing, updated_at: new Date().toISOString(),
  }, { onConflict: "analysis_id" }).select("technique_label,landing_choice,service_score").single();
  if (error) return NextResponse.json({ error: "확인 결과를 저장하지 못했습니다." }, { status: 500 });
  return NextResponse.json({ review });
}
