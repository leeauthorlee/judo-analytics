import { get } from "@vercel/blob";
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/config";

export const runtime = "nodejs";

export async function GET(request: Request) {
  if (!isSupabaseConfigured() || !process.env.BLOB_READ_WRITE_TOKEN) {
    return new NextResponse(null, { status: 503 });
  }

  const key = new URL(request.url).searchParams.get("key");
  if (!key || !/^workspaces\/[a-f0-9-]{36}\/[a-f0-9-]{36}\.jpg$/i.test(key)) {
    return new NextResponse(null, { status: 400 });
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return new NextResponse(null, { status: 401 });

  const { data: highlight } = await supabase
    .from("highlights")
    .select("video_id")
    .eq("thumbnail_key", key)
    .maybeSingle();
  if (!highlight) return new NextResponse(null, { status: 404 });

  const { data: asset } = await supabase
    .from("video_assets")
    .select("workspace_id")
    .eq("id", highlight.video_id)
    .maybeSingle();
  if (!asset) return new NextResponse(null, { status: 404 });

  const { data: workspace } = await supabase
    .from("workspaces")
    .select("user_id")
    .eq("id", asset.workspace_id)
    .maybeSingle();
  if (!workspace || workspace.user_id !== user.id) {
    return new NextResponse(null, { status: 404 });
  }

  try {
    const blob = await get(key, { access: "private", token: process.env.BLOB_READ_WRITE_TOKEN });
    if (!blob?.stream) return new NextResponse(null, { status: 404 });
    return new Response(blob.stream, {
      headers: {
        "Content-Type": "image/jpeg",
        "Cache-Control": "private, max-age=3600",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch {
    return new NextResponse(null, { status: 404 });
  }
}
