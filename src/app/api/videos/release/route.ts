import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { releaseVideo } from "@/lib/video-cleanup";

export const runtime = "nodejs";

/** Fire-and-forget cleanup used by pagehide/sendBeacon. Always idempotent. */
export async function POST(request: Request) {
  if (!isSupabaseConfigured() || !process.env.BLOB_READ_WRITE_TOKEN) {
    return new NextResponse(null, { status: 503 });
  }
  let videoId: unknown;
  try {
    const text = await request.text();
    const body = text ? JSON.parse(text) : {};
    videoId = body.videoId;
  } catch {
    return new NextResponse(null, { status: 400 });
  }
  if (typeof videoId !== "string" || !/^[a-f0-9-]{36}$/i.test(videoId)) {
    return new NextResponse(null, { status: 400 });
  }
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return new NextResponse(null, { status: 401 });

  const result = await releaseVideo(supabase, videoId);
  return NextResponse.json({ released: result.ok, reason: result.reason ?? null }, { status: result.ok ? 200 : 502 });
}
