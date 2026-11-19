import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { isGuestUser } from "@/lib/access";
import { MAX_DIARY_CONTENT } from "@/lib/diary";

export const runtime = "nodejs";

async function actor() {
  if (!isSupabaseConfigured()) return { error: NextResponse.json({ error: "서비스 설정이 필요합니다." }, { status: 503 }) };
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 }) };
  if (isGuestUser(user)) return { error: NextResponse.json({ error: "임시 세션에서는 일기를 수정할 수 없습니다." }, { status: 403 }) };
  return { supabase };
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await actor();
  if (auth.error) return auth.error;
  const { id } = await context.params;
  if (!/^[a-f0-9-]{36}$/i.test(id)) return NextResponse.json({ error: "잘못된 일기 ID입니다." }, { status: 400 });
  let body: { title?: unknown; note?: unknown };
  try { body = await request.json(); } catch { return NextResponse.json({ error: "잘못된 요청입니다." }, { status: 400 }); }
  if (
    (body.title !== undefined && (typeof body.title !== "string" || !body.title.trim() || body.title.length > 120)) ||
    (body.note !== undefined && body.note !== null && (typeof body.note !== "string" || body.note.length > MAX_DIARY_CONTENT))
  ) {
    return NextResponse.json({ error: `제목은 120자, 내용은 ${MAX_DIARY_CONTENT}자 이하여야 합니다.` }, { status: 400 });
  }
  const update: { title?: string; note?: string | null } = {};
  if (typeof body.title === "string") update.title = body.title.trim();
  if (body.note !== undefined) update.note = body.note as string | null;
  const { data, error } = await auth.supabase.from("diary_entries")
    .update(update).eq("id", id)
    .select("id,entry_date,title,note,created_at")
    .maybeSingle();
  if (error || !data) return NextResponse.json({ error: "일기를 수정하지 못했습니다." }, { status: 500 });
  return NextResponse.json({ diary: data });
}

export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await actor();
  if (auth.error) return auth.error;
  const { id } = await context.params;
  if (!/^[a-f0-9-]{36}$/i.test(id)) return NextResponse.json({ error: "잘못된 일기 ID입니다." }, { status: 400 });
  const { error } = await auth.supabase.from("diary_entries").delete().eq("id", id);
  if (error) return NextResponse.json({ error: "일기를 삭제하지 못했습니다." }, { status: 500 });
  return NextResponse.json({ deleted: true });
}
