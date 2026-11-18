import { redirect } from "next/navigation";
import SiteHeader from "@/app/components/site-header";
import HomeClient from "@/app/home-client";
import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/config";

export default async function Home() {
  let email: string | null = null;
  let userId = "";
  let videos: Awaited<ReturnType<typeof getVideos>> = [];
  let analyses: Awaited<ReturnType<typeof getAnalyses>> = [];
  let highlights: Awaited<ReturnType<typeof getHighlights>> = [];
  let diaries: Awaited<ReturnType<typeof getDiaries>> = [];
  type DiaryWithThumb = {
    id: string;
    entry_date: string;
    title: string;
    note: string | null;
    created_at: string;
    thumbnailUrl: string | null;
  };
  let diariesWithThumb: DiaryWithThumb[] = [];

  if (isSupabaseConfigured()) {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    email = user?.email ?? null;
    userId = user?.id ?? "";

    if (user) {
      const { data: workspace } = await supabase
        .from("workspaces")
        .select("id")
        .eq("user_id", user.id)
        .maybeSingle();

      if (workspace) {
        videos = await getVideos(supabase, workspace.id);
        const ids = videos.map((video) => video.id);
        analyses = await getAnalyses(supabase, ids);
        highlights = await getHighlights(supabase, ids);
        diaries = await getDiaries(supabase, workspace.id);

        const thumbnailUrls = new Map<string, string>();
        for (const item of highlights) {
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
        diariesWithThumb = diaries.map((diary) => ({
          id: diary.id,
          entry_date: diary.entry_date,
          title: diary.title,
          note: diary.note,
          created_at: diary.created_at,
          thumbnailUrl: diaryThumbnails.get(diary.id) ?? null,
        }));
      }
    }
  }

  if (!email && isSupabaseConfigured()) redirect("/login");

  return (
    <main>
      <SiteHeader email={email} />
      <HomeClient
        userId={userId}
        videos={videos}
        analyses={analyses}
        highlights={highlights}
        diaries={diariesWithThumb}
      />
    </main>
  );
}

async function getVideos(supabase: Awaited<ReturnType<typeof createClient>>, workspaceId: string) {
  const { data } = await supabase
    .from("video_assets")
    .select("id,original_name,size_bytes,status,created_at")
    .eq("workspace_id", workspaceId)
    .is("deleted_at", null)
    .order("created_at", { ascending: false });
  return data ?? [];
}

async function getAnalyses(supabase: Awaited<ReturnType<typeof createClient>>, videoIds: string[]) {
  if (!videoIds.length) return [];
  const { data } = await supabase
    .from("video_analyses")
    .select("id,video_id,status,error_code,result_json,created_at,analysis_reviews(technique_label,landing_choice,service_score)")
    .in("video_id", videoIds)
    .order("created_at", { ascending: false });
  return data ?? [];
}

async function getHighlights(supabase: Awaited<ReturnType<typeof createClient>>, videoIds: string[]) {
  if (!videoIds.length) return [];
  const { data } = await supabase
    .from("highlights")
    .select("id,video_id,event_id,start_ms,end_ms,title,thumbnail_key,created_at")
    .in("video_id", videoIds)
    .order("created_at", { ascending: false });
  return data ?? [];
}

async function getDiaries(supabase: Awaited<ReturnType<typeof createClient>>, workspaceId: string) {
  const { data } = await supabase
    .from("diary_entries")
    .select("id,entry_date,title,note,created_at,diary_entry_highlights(highlight_id)")
    .eq("workspace_id", workspaceId)
    .order("entry_date", { ascending: false });
  return data ?? [];
}
