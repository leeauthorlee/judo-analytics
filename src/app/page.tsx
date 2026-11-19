import SiteHeader from "@/app/components/site-header";
import HomeClient from "@/app/home-client";
import { getViewer } from "@/lib/access";
import { createClient } from "@/lib/supabase/server";
import { aiPointsFromResult, POINTS_PER_DIARY } from "@/lib/scoring/policy";

type DiaryWithThumb = {
  id: string;
  entry_date: string;
  title: string;
  note: string | null;
  created_at: string;
  thumbnailUrl: string | null;
  points: number;
  videoId: string | null;
};

export default async function Home() {
  const viewer = await getViewer();
  const email = viewer && !viewer.isGuest ? viewer.email : null;
  // A visitor without any session is treated like a guest in the UI.
  const isGuest = viewer ? viewer.isGuest : true;
  let videos: Awaited<ReturnType<typeof getVideos>> = [];
  let analyses: Awaited<ReturnType<typeof getAnalyses>> = [];
  let diariesWithThumb: DiaryWithThumb[] = [];

  if (viewer) {
    const supabase = viewer.supabase;
    const { data: workspace } = await supabase.from("workspaces").select("id").eq("user_id", viewer.userId).maybeSingle();
    if (workspace) {
      videos = await getVideos(supabase, workspace.id);
      const ids = videos.map((video) => video.id);
      analyses = await getAnalyses(supabase, ids);
      if (!isGuest) {
        const diaries = await getDiaries(supabase, workspace.id);
        const highlightIds = [...new Set((diaries ?? []).flatMap((diary) =>
          (diary.diary_entry_highlights ?? []).map((link) => link.highlight_id)))];
        const { data: highlights } = highlightIds.length
          ? await supabase.from("highlights").select("id,thumbnail_key").in("id", highlightIds)
          : { data: [] };
        const thumbnailUrls = new Map<string, string>();
        for (const item of highlights ?? []) {
          if (item.thumbnail_key) {
            thumbnailUrls.set(item.id, `/api/blob/thumbnail?key=${encodeURIComponent(item.thumbnail_key)}`);
          }
        }
        const diaryThumbnails = new Map<string, string>();
        for (const diary of diaries) {
          for (const link of diary.diary_entry_highlights ?? []) {
            const url = thumbnailUrls.get(link.highlight_id);
            if (url && !diaryThumbnails.has(diary.id)) diaryThumbnails.set(diary.id, url);
          }
        }
        const sourceIds = [...new Set(diaries.map((diary) => diary.source_analysis_id).filter((id): id is string => Boolean(id)))];
        const pointsById = new Map<string, number>();
        const videoByAnalysis = new Map<string, string>();
        if (sourceIds.length) {
          const { data: sourceAnalyses } = await supabase.from("video_analyses").select("id,video_id,result_json").in("id", sourceIds);
          for (const analysis of sourceAnalyses ?? []) {
            pointsById.set(analysis.id, aiPointsFromResult(analysis.result_json));
            videoByAnalysis.set(analysis.id, analysis.video_id);
          }
        }
        diariesWithThumb = diaries.map((diary) => ({
          id: diary.id,
          entry_date: diary.entry_date,
          title: diary.title,
          note: diary.note,
          created_at: diary.created_at,
          thumbnailUrl: diaryThumbnails.get(diary.id) ?? null,
          points: diary.source_analysis_id ? pointsById.get(diary.source_analysis_id) ?? 0 : POINTS_PER_DIARY,
          videoId: diary.source_analysis_id ? videoByAnalysis.get(diary.source_analysis_id) ?? null : null,
        }));
      }
    }
  }

  return (
    <main>
      <SiteHeader email={email} />
      <HomeClient
        userId={viewer?.userId ?? ""}
        email={email}
        isGuest={isGuest}
        videos={videos}
        analyses={analyses}
        diaries={diariesWithThumb}
      />
    </main>
  );
}

type WebSupabase = Awaited<ReturnType<typeof createClient>>;

async function getVideos(supabase: WebSupabase, workspaceId: string) {
  const { data } = await supabase
    .from("video_assets")
    .select("id,original_name,size_bytes,status,created_at")
    .eq("workspace_id", workspaceId)
    .is("deleted_at", null)
    .order("created_at", { ascending: false });
  return data ?? [];
}

async function getAnalyses(supabase: WebSupabase, videoIds: string[]) {
  if (!videoIds.length) return [];
  const { data } = await supabase
    .from("video_analyses")
    .select("id,video_id,status,error_code,result_json,created_at,analysis_reviews(technique_label,landing_choice,service_score)")
    .in("video_id", videoIds)
    .order("created_at", { ascending: false });
  return data ?? [];
}

async function getDiaries(supabase: WebSupabase, workspaceId: string) {
  const { data } = await supabase
    .from("diary_entries")
    .select("id,entry_date,title,note,created_at,source_analysis_id,diary_entry_highlights(highlight_id)")
    .eq("workspace_id", workspaceId)
    .order("created_at", { ascending: false });
  return data ?? [];
}
