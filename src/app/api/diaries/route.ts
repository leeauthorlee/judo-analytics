import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/config";

export async function POST(request: Request) {
  if (!isSupabaseConfigured()) return NextResponse.json({ error: "서비스 설정이 필요합니다." }, { status: 503 });
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });

  let body: { entryDate?: unknown; title?: unknown; note?: unknown; highlightIds?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "잘못된 일기 요청입니다." }, { status: 400 });
  }
  if (
    typeof body.entryDate !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(body.entryDate) ||
    typeof body.title !== "string" || !body.title.trim() || body.title.length > 120 ||
    (body.note !== undefined && body.note !== null && (typeof body.note !== "string" || body.note.length > 4000)) ||
    (body.highlightIds !== undefined && (!Array.isArray(body.highlightIds) || body.highlightIds.length > 20 || body.highlightIds.some((id) => typeof id !== "string" || !/^[a-f0-9-]{36}$/i.test(id))))
  ) {
    return NextResponse.json({ error: "일기 내용을 확인해 주세요." }, { status: 400 });
  }

  const { data: workspace } = await supabase.from("workspaces").select("id").eq("user_id", user.id).maybeSingle();
  if (!workspace) return NextResponse.json({ error: "사용자 작업공간을 찾을 수 없습니다." }, { status: 409 });

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
  return NextResponse.json({ diary }, { status: 201 });
}
