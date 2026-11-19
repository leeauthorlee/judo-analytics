import "server-only";
import { del } from "@vercel/blob";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient, isAdminConfigured } from "@/lib/supabase/admin";
import { isPendingDiary } from "@/lib/diary";

export type ReleaseResult = { ok: boolean; reason?: string; kept?: boolean };

/**
 * Idempotent, owner-scoped removal of one temporary upload. The caller must
 * have already verified ownership with an RLS-scoped Supabase client.
 * A video linked to a registered diary is kept so the diary can play it.
 */
export async function releaseVideo(supabase: SupabaseClient, videoId: string): Promise<ReleaseResult> {
  const { data: video, error: videoError } = await supabase
    .from("video_assets")
    .select("id,storage_key,deleted_at")
    .eq("id", videoId)
    .maybeSingle();
  if (videoError) return { ok: false, reason: "lookup_failed" };
  if (!video || video.deleted_at) return { ok: true };

  const { data: analyses } = await supabase.from("video_analyses").select("id,status").eq("video_id", videoId);
  const analysisIds = (analyses ?? []).map((a) => a.id);
  const { data: diaries } = analysisIds.length
    ? await supabase.from("diary_entries").select("id,note").in("source_analysis_id", analysisIds)
    : { data: [] };
  const pendingIds = (diaries ?? []).filter((d) => isPendingDiary(d.note)).map((d) => d.id);
  if (diaries && diaries.length > pendingIds.length) {
    return { ok: true, kept: true };
  }

  if (isAdminConfigured()) {
    const admin = createAdminClient();
    const activeIds = (analyses ?? []).filter((a) => a.status === "queued" || a.status === "processing").map((a) => a.id);
    if (activeIds.length) {
      await admin.from("video_analyses").update({ status: "failed", error_code: "CANCELLED", completed_at: new Date().toISOString() })
        .in("id", activeIds);
    }
  }

  if (pendingIds.length) {
    const { error } = await supabase.from("diary_entries").delete().in("id", pendingIds);
    if (error) console.error("VIDEO_RELEASE_PENDING_DIARY_FAILED", videoId, error.message);
  }

  if (process.env.BLOB_READ_WRITE_TOKEN) {
    try {
      await del(video.storage_key, { token: process.env.BLOB_READ_WRITE_TOKEN });
    } catch (cause) {
      console.error("VIDEO_RELEASE_BLOB_FAILED", videoId, cause);
      return { ok: false, reason: "blob_delete_failed" };
    }
  }

  const { error: markError } = await supabase
    .from("video_assets")
    .update({ deleted_at: new Date().toISOString(), status: "deleted" })
    .eq("id", videoId);
  if (markError) {
    console.error("VIDEO_RELEASE_MARK_FAILED", videoId, markError.message);
    return { ok: false, reason: "mark_failed" };
  }
  return { ok: true };
}
