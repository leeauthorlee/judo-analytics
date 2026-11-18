import { del } from "@vercel/blob";
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/config";

export const runtime = "nodejs";

export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }) {
  if (!isSupabaseConfigured() || !process.env.BLOB_READ_WRITE_TOKEN) {
    return NextResponse.json({ error: "로그인 또는 저장소 설정이 필요합니다." }, { status: 503 });
  }
  const { id } = await context.params;
  if (!/^[a-f0-9-]{36}$/i.test(id)) return NextResponse.json({ error: "잘못된 영상 ID입니다." }, { status: 400 });

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });

  const { data: video } = await supabase
    .from("video_assets")
    .select("id,storage_key")
    .eq("id", id)
    .maybeSingle();
  if (!video) return NextResponse.json({ error: "영상을 찾을 수 없습니다." }, { status: 404 });

  try {
    await del(video.storage_key, { token: process.env.BLOB_READ_WRITE_TOKEN });
  } catch {
    return NextResponse.json({ error: "비공개 영상 파일을 삭제하지 못했습니다." }, { status: 502 });
  }

  const { error } = await supabase.from("video_assets").delete().eq("id", id);
  if (error) return NextResponse.json({ error: "영상 기록을 삭제하지 못했습니다." }, { status: 500 });
  return NextResponse.json({ deleted: true });
}
