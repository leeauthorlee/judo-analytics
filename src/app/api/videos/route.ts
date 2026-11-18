import { head } from "@vercel/blob";
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/config";

export const runtime = "nodejs";
const MAX_VIDEO_BYTES = 500 * 1024 * 1024;

export async function POST(request: Request) {
  if (!isSupabaseConfigured() || !process.env.BLOB_READ_WRITE_TOKEN) {
    return NextResponse.json({ error: "로그인 또는 영상 저장소 설정이 필요합니다." }, { status: 503 });
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });

  let body: { pathname?: unknown; originalName?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "잘못된 영상 정보입니다." }, { status: 400 });
  }

  const pathname = body.pathname;
  const originalName = body.originalName;
  if (
    typeof pathname !== "string" ||
    !pathname.startsWith(`workspaces/${user.id}/`) ||
    !/^workspaces\/[a-f0-9-]{36}\/[a-f0-9-]{36}\.mp4$/i.test(pathname) ||
    typeof originalName !== "string"
  ) {
    return NextResponse.json({ error: "영상 정보가 올바르지 않습니다." }, { status: 400 });
  }

  let blob;
  try {
    blob = await head(pathname, { token: process.env.BLOB_READ_WRITE_TOKEN });
  } catch (cause) {
    console.error("BLOB_HEAD_FAILED", pathname, cause);
    return NextResponse.json({ error: `업로드된 영상을 찾을 수 없습니다: ${cause instanceof Error ? cause.message : "unknown"}` }, { status: 404 });
  }

  try {
    if (blob.contentType !== "video/mp4" || blob.size <= 0 || blob.size > MAX_VIDEO_BYTES) {
      return NextResponse.json({ error: "MP4 형식 또는 파일 크기를 확인해 주세요." }, { status: 400 });
    }

    const { data: workspace, error: workspaceError } = await supabase
      .from("workspaces")
      .select("id")
      .eq("user_id", user.id)
      .single();
    if (workspaceError || !workspace) {
      return NextResponse.json({ error: "사용자 작업공간을 찾을 수 없습니다." }, { status: 409 });
    }

    const { data: existing } = await supabase
      .from("video_assets")
      .select("id,original_name,size_bytes,status,created_at")
      .eq("storage_key", pathname)
      .maybeSingle();
    if (existing) return NextResponse.json({ video: existing });

    const { data: video, error } = await supabase
      .from("video_assets")
      .insert({
        workspace_id: workspace.id,
        storage_key: pathname,
        original_name: originalName.slice(0, 160),
        content_type: "video/mp4",
        size_bytes: blob.size,
      })
      .select("id,original_name,size_bytes,status,created_at")
      .single();
    if (error || !video) {
      console.error("VIDEO_INSERT_FAILED", error);
      return NextResponse.json({ error: `영상 정보를 저장하지 못했습니다: ${error?.message ?? "unknown"}` }, { status: 500 });
    }
    return NextResponse.json({ video }, { status: 201 });
  } catch (cause) {
    console.error("VIDEO_SAVE_FAILED", cause);
    return NextResponse.json({ error: `저장된 영상 정보를 확인하지 못했습니다: ${cause instanceof Error ? cause.message : "unknown"}` }, { status: 404 });
  }
}
