import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/config";

export const runtime = "nodejs";

const MAX_VIDEO_BYTES = 500 * 1024 * 1024;

export async function POST(request: Request) {
  if (!isSupabaseConfigured()) {
    return NextResponse.json({ error: "Supabase 로그인이 설정되지 않았습니다." }, { status: 503 });
  }
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    return NextResponse.json({ error: "Vercel Blob이 설정되지 않았습니다." }, { status: 503 });
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });

  let body: HandleUploadBody;
  try {
    body = (await request.json()) as HandleUploadBody;
  } catch {
    return NextResponse.json({ error: "잘못된 업로드 요청입니다." }, { status: 400 });
  }

  try {
    const jsonResponse = await handleUpload({
      body,
      request,
      onBeforeGenerateToken: async (pathname) => {
        const match = pathname.match(/^workspaces\/([a-f0-9-]{36})\/([a-f0-9-]{36})\.mp4$/i);
        if (!match || match[1].toLowerCase() !== user.id.toLowerCase()) {
          throw new Error("Invalid video path");
        }

        return {
          allowedContentTypes: ["video/mp4"],
          maximumSizeInBytes: MAX_VIDEO_BYTES,
          addRandomSuffix: false,
          tokenPayload: JSON.stringify({ userId: user.id, purpose: "judo-analysis-upload" }),
        };
      },
    });

    return NextResponse.json(jsonResponse);
  } catch {
    return NextResponse.json({ error: "업로드 권한을 발급하지 못했습니다." }, { status: 400 });
  }
}
