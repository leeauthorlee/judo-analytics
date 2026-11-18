import { get } from "@vercel/blob";
import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/config";

export const runtime = "nodejs";
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  if (!isSupabaseConfigured() || !process.env.BLOB_READ_WRITE_TOKEN) return new Response(null, { status: 503 });
  const { id } = await context.params;
  if (!/^[a-f0-9-]{36}$/i.test(id)) return new Response(null, { status: 400 });
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return new Response(null, { status: 401 });
  const { data: video } = await supabase.from("video_assets").select("storage_key").eq("id", id).is("deleted_at", null).maybeSingle();
  if (!video) return new Response(null, { status: 404 });
  const range = request.headers.get("range");
  if (range && !/^bytes=(?:\d+-\d*|-\d+)$/.test(range)) return new Response(null, { status: 416 });
  try {
    const blob = await get(video.storage_key, { access: "private", token: process.env.BLOB_READ_WRITE_TOKEN, useCache: false,
      headers: range ? { Range: range } : undefined });
    if (!blob?.stream) return new Response(null, { status: 404 });
    const headers = new Headers({ "Content-Type": "video/mp4", "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" });
    for (const name of ["content-range", "content-length", "accept-ranges"]) {
      const value = blob.headers.get(name); if (value) headers.set(name, value);
    }
    return new Response(blob.stream, { status: headers.has("content-range") ? 206 : 200, headers });
  } catch { return new Response(null, { status: 502 }); }
}
