import { del } from "@vercel/blob";
import { NextResponse } from "next/server";
import { createAdminClient, isAdminConfigured } from "@/lib/supabase/admin";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { isPendingDiary } from "@/lib/diary";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** TTL reaper. Safe to call repeatedly; never removes active analyses. */
async function runCleanup() {
  if (!isSupabaseConfigured() || !isAdminConfigured() || !process.env.BLOB_READ_WRITE_TOKEN) {
    return NextResponse.json({ error: "정리 작업 설정이 필요합니다." }, { status: 503 });
  }
  const ttlHours = Number(process.env.VIDEO_TTL_HOURS ?? 24);
  const cutoff = new Date(Date.now() - (Number.isFinite(ttlHours) ? ttlHours : 24) * 3600_000).toISOString();
  const admin = createAdminClient();
  const result = { videosDeleted: 0, blobsFailed: 0, guestsDeleted: 0, errors: 0 };

  const { data: videos, error } = await admin
    .from("video_assets")
    .select("id,storage_key,created_at")
    .is("deleted_at", null)
    .lt("created_at", cutoff)
    .limit(100);
  if (error) {
    console.error("CLEANUP_LIST_FAILED", error.message);
    return NextResponse.json({ error: "정리 대상을 조회하지 못했습니다." }, { status: 500 });
  }

  for (const video of videos ?? []) {
    const { data: analyses } = await admin
      .from("video_analyses")
      .select("id,status")
      .eq("video_id", video.id);
    if (analyses?.some((a) => a.status === "queued" || a.status === "processing")) continue;
    const analysisIds = (analyses ?? []).map((a) => a.id);
    const { data: diaries } = analysisIds.length
      ? await admin.from("diary_entries").select("note").in("source_analysis_id", analysisIds)
      : { data: [] };
    if (diaries?.some((d) => !isPendingDiary(d.note))) continue;
    try {
      await del(video.storage_key, { token: process.env.BLOB_READ_WRITE_TOKEN });
      result.videosDeleted += 1;
    } catch (cause) {
      result.blobsFailed += 1;
      console.error("CLEANUP_BLOB_FAILED", video.id, cause);
      continue;
    }
    const { error: updateError } = await admin
      .from("video_assets")
      .update({ deleted_at: new Date().toISOString(), status: "deleted" })
      .eq("id", video.id);
    if (updateError) {
      result.errors += 1;
      console.error("CLEANUP_MARK_FAILED", video.id, updateError.message);
    }
  }

  // Remove temporary guest accounts only after their blobs were cleaned above.
  for (let page = 1; page <= 10; page += 1) {
    const { data, error: listError } = await admin.auth.admin.listUsers({ page, perPage: 100 });
    if (listError) { console.error("CLEANUP_GUEST_LIST_FAILED", listError.message); break; }
    const guests = (data?.users ?? []).filter(
      (u) => u.user_metadata?.is_guest === true && new Date(u.created_at).toISOString() < cutoff,
    );
    for (const guest of guests) {
      const { error: deleteError } = await admin.auth.admin.deleteUser(guest.id);
      if (deleteError) {
        result.errors += 1;
        console.error("CLEANUP_GUEST_DELETE_FAILED", guest.id, deleteError.message);
      } else {
        result.guestsDeleted += 1;
      }
    }
    if ((data?.users?.length ?? 0) < 100) break;
  }
  return NextResponse.json(result);
}

function isAuthorized(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const header = request.headers.get("authorization") ?? request.headers.get("x-cleanup-secret") ?? "";
  return header.replace(/^Bearer\s+/i, "") === secret;
}

export async function GET(request: Request) {
  if (!isAuthorized(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  return runCleanup();
}

export async function POST(request: Request) {
  if (!isAuthorized(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  return runCleanup();
}
