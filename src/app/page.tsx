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
        diaries={diaries}
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
    .select("id,video_id,status,error_code,result_json,created_at")
    .in("video_id", videoIds)
    .order("created_at", { ascending: false });
  return data ?? [];
}

async function getHighlights(supabase: Awaited<ReturnType<typeof createClient>>, videoIds: string[]) {
  if (!videoIds.length) return [];
  const { data } = await supabase
    .from("highlights")
    .select("id,video_id,event_id,start_ms,end_ms,title,created_at")
    .in("video_id", videoIds)
    .order("created_at", { ascending: false });
  return data ?? [];
}

async function getDiaries(supabase: Awaited<ReturnType<typeof createClient>>, workspaceId: string) {
  const { data } = await supabase
    .from("diary_entries")
    .select("id,entry_date,title,note,created_at")
    .eq("workspace_id", workspaceId)
    .order("entry_date", { ascending: false });
  return data ?? [];
}
