import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { isGuestUser } from "@/lib/access";
import { isPendingDiary, MAX_DIARY_CONTENT } from "@/lib/diary";
import { POINTS_PER_DIARY, pointsForTechnique, techniqueName } from "@/lib/scoring/policy";

export const runtime = "nodejs";

function memberGuard() {
  if (!isSupabaseConfigured()) return NextResponse.json({ error: "서비스 설정이 필요합니다." }, { status: 503 });
  return null;
}

export async function GET() {
  const configError = memberGuard();
  if (configError) return configError;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  if (isGuestUser(user)) return NextResponse.json({ error: "임시 세션에서는 일기를 조회할 수 없습니다." }, { status: 403 });

  const { data: workspace } = await supabase.from("workspaces").select("id").eq("user_id", user.id).maybeSingle();
  if (!workspace) return NextResponse.json({ diaries: [] });
  const { data, error } = await supabase
    .from("diary_entries")
    .select("id,entry_date,title,note,created_at,source_analysis_id,diary_entry_highlights(highlight_id)")
    .eq("workspace_id", workspace.id)
    .order("created_at", { ascending: false });
  if (error) return NextResponse.json({ error: "일기를 불러오지 못했습니다." }, { status: 500 });
  const diaries = (data ?? []).filter((item) => !isPendingDiary(item.note))
    .map((item) => ({ ...item, points: POINTS_PER_DIARY }));
  return NextResponse.json({ diaries });
}

export async function POST(request: Request) {
  const configError = memberGuard();
  if (configError) return configError;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  if (isGuestUser(user)) return NextResponse.json({ error: "일기를 등록하려면 로그인이 필요합니다." }, { status: 403 });

  let body: {
    analysisId?: unknown; content?: unknown; entryDate?: unknown;
    title?: unknown; note?: unknown; highlightIds?: unknown;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "잘못된 일기 요청입니다." }, { status: 400 });
  }

  const { data: workspace } = await supabase.from("workspaces").select("id").eq("user_id", user.id).maybeSingle();
  if (!workspace) return NextResponse.json({ error: "사용자 작업공간을 찾을 수 없습니다." }, { status: 409 });

  // Analysis-linked registration: technique and points are derived on the server.
  if (body.analysisId !== undefined) {
    const analysisId = body.analysisId;
    if (typeof analysisId !== "string" || !/^[a-f0-9-]{36}$/i.test(analysisId) ||
        typeof body.content !== "string" || body.content.length > MAX_DIARY_CONTENT) {
      return NextResponse.json({ error: `일기 내용은 ${MAX_DIARY_CONTENT}자 이하여야 합니다.` }, { status: 400 });
    }
    const { data: analysis } = await supabase
      .from("video_analyses")
      .select("id,status,result_json,analysis_reviews(technique_label)")
      .eq("id", analysisId)
      .maybeSingle();
    if (!analysis) return NextResponse.json({ error: "분석 결과를 찾을 수 없습니다." }, { status: 404 });
    if (!["review_required", "completed"].includes(analysis.status) || analysis.result_json?.provider !== "local-r3d18") {
      return NextResponse.json({ error: "완료된 분석만 일기에 등록할 수 있습니다." }, { status: 409 });
    }
    const review = Array.isArray(analysis.analysis_reviews) ? analysis.analysis_reviews[0] : analysis.analysis_reviews;
    const name = techniqueName(review?.technique_label);
    if (!name) return NextResponse.json({ error: "확인된 기술이 없습니다. 먼저 기술을 확인해 주세요." }, { status: 409 });

    const { data: existing } = await supabase
      .from("diary_entries")
      .select("id,note")
      .eq("source_analysis_id", analysisId)
      .maybeSingle();
    const content = body.content.trim();
    if (existing && !isPendingDiary(existing.note)) {
      return NextResponse.json({ error: "이미 일기에 등록된 분석입니다.", points: 0 }, { status: 409 });
    }
    if (existing) {
      const { data: diary, error } = await supabase
        .from("diary_entries")
        .update({ title: name, note: content })
        .eq("id", existing.id)
        .eq("workspace_id", workspace.id)
        .select("id,entry_date,title,note,created_at,source_analysis_id")
        .single();
      if (error || !diary) return NextResponse.json({ error: "일기를 저장하지 못했습니다." }, { status: 500 });
      return NextResponse.json({ diary, points: pointsForTechnique(review.technique_label) }, { status: 200 });
    }
    const { data: diary, error } = await supabase
      .from("diary_entries")
      .insert({
        workspace_id: workspace.id,
        entry_date: new Date().toISOString().slice(0, 10),
        title: name,
        note: content,
        source_analysis_id: analysisId,
      })
      .select("id,entry_date,title,note,created_at,source_analysis_id")
      .single();
    if (error || !diary) return NextResponse.json({ error: "일기를 저장하지 못했습니다." }, { status: 500 });
    return NextResponse.json({ diary, points: pointsForTechnique(review.technique_label) }, { status: 201 });
  }

  // Manual diary (kept for backwards compatibility).
  if (
    typeof body.entryDate !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(body.entryDate) ||
    typeof body.title !== "string" || !body.title.trim() || body.title.length > 120 ||
    (body.note !== undefined && body.note !== null && (typeof body.note !== "string" || body.note.length > MAX_DIARY_CONTENT)) ||
    (body.highlightIds !== undefined && (!Array.isArray(body.highlightIds) || body.highlightIds.length > 20 || body.highlightIds.some((id) => typeof id !== "string" || !/^[a-f0-9-]{36}$/i.test(id))))
  ) {
    return NextResponse.json({ error: `일기 내용은 ${MAX_DIARY_CONTENT}자 이하여야 합니다.` }, { status: 400 });
  }

  const { data: diary, error } = await supabase
    .from("diary_entries")
    .insert({ workspace_id: workspace.id, entry_date: body.entryDate, title: body.title.trim(), note: body.note ?? null })
    .select("id,entry_date,title,note,created_at")
    .single();
  if (error || !diary) return NextResponse.json({ error: "일기를 저장하지 못했습니다." }, { status: 500 });

  const highlightIds = (body.highlightIds ?? []) as string[];
  if (highlightIds.length) {
    const { error: linkError } = await supabase.from("diary_entry_highlights").insert(
      highlightIds.map((highlightId, sortOrder) => ({ highlight_id: highlightId, diary_entry_id: diary.id, sort_order: sortOrder })),
    );
    if (linkError) {
      await supabase.from("diary_entries").delete().eq("id", diary.id);
      return NextResponse.json({ error: "일기와 하이라이트를 연결하지 못했습니다." }, { status: 400 });
    }
  }
  return NextResponse.json({ diary, points: POINTS_PER_DIARY }, { status: 201 });
}
