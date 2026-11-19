import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { releaseVideo } from "@/lib/video-cleanup";

export const runtime = "nodejs";

export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }) {
  if (!isSupabaseConfigured() || !process.env.BLOB_READ_WRITE_TOKEN) {
    return NextResponse.json({ error: "저장소 설정이 필요합니다." }, { status: 503 });
  }
  const { id } = await context.params;
  if (!/^[a-f0-9-]{36}$/i.test(id)) return NextResponse.json({ error: "잘못된 영상 ID입니다." }, { status: 400 });

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });

  // Idempotent: a second call for an already released video succeeds.
  const result = await releaseVideo(supabase, id);
  if (!result.ok) {
    return NextResponse.json({ error: "영상 삭제를 완료하지 못했습니다. 다시 시도해 주세요." }, { status: 502 });
  }
  return NextResponse.json({ deleted: true });
}
