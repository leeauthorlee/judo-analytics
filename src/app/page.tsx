import { redirect } from "next/navigation";
import DashboardClient from "@/app/dashboard-client";
import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/config";

export default async function Home() {
  if (!isSupabaseConfigured()) {
    return (
      <main className="auth-page">
        <section className="auth-card">
          <p className="eyebrow">JUDO ANALYTICS</p>
          <h1>배포 설정이 필요합니다.</h1>
          <p>Supabase 프로젝트와 환경변수를 연결한 뒤 로그인할 수 있습니다. 설정 단계는 <code>docs/deployment/cloud-stack.md</code>에 있습니다.</p>
        </section>
      </main>
    );
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: workspace } = await supabase
    .from("workspaces")
    .select("id")
    .eq("user_id", user.id)
    .maybeSingle();
  if (!workspace) {
    return (
      <main className="auth-page">
        <section className="auth-card">
          <h1>작업공간을 준비할 수 없습니다.</h1>
          <p>Supabase 초기 마이그레이션이 적용되었는지 확인해 주세요.</p>
        </section>
      </main>
    );
  }

  const { data: videos } = await supabase
    .from("video_assets")
    .select("id,original_name,size_bytes,status,created_at")
    .eq("workspace_id", workspace.id)
    .is("deleted_at", null)
    .order("created_at", { ascending: false });
  const videoIds = (videos ?? []).map((video) => video.id);
  const { data: analyses } = videoIds.length
    ? await supabase
        .from("video_analyses")
        .select("id,video_id,status,error_code,result_json,created_at,completed_at")
        .in("video_id", videoIds)
        .order("created_at", { ascending: false })
    : { data: [] };
  const { data: highlights } = videoIds.length
    ? await supabase
        .from("highlights")
        .select("id,video_id,event_id,start_ms,end_ms,title,note,created_at")
        .in("video_id", videoIds)
        .order("created_at", { ascending: false })
    : { data: [] };
  const { data: diaries } = await supabase
    .from("diary_entries")
    .select("id,entry_date,title,note,created_at")
    .eq("workspace_id", workspace.id)
    .order("entry_date", { ascending: false });

  return (
    <DashboardClient
      userId={user.id}
      email={user.email ?? ""}
      videos={videos ?? []}
      analyses={analyses ?? []}
      highlights={highlights ?? []}
      diaries={diaries ?? []}
    />
  );
}
