import { redirect } from "next/navigation";
import SiteHeader from "@/app/components/site-header";
import RecordsClient from "@/app/records/records-client";
import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/config";

export default async function RecordsPage() {
  if (!isSupabaseConfigured()) {
    return (
      <main>
        <SiteHeader />
        <section className="section">
          <h1>배포 설정이 필요합니다.</h1>
          <p>Supabase 환경변수를 연결한 뒤 이용할 수 있습니다.</p>
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
      <main>
        <SiteHeader email={user.email} />
        <section className="section">
          <h1>작업공간을 준비할 수 없습니다.</h1>
          <p>초기 마이그레이션이 적용되었는지 확인해 주세요.</p>
        </section>
      </main>
    );
  }

  const { data: videos } = await supabase
    .from("video_assets")
    .select("id")
    .eq("workspace_id", workspace.id)
    .is("deleted_at", null);
  const videoIds = (videos ?? []).map((video) => video.id);

  const { data: highlights } = videoIds.length
    ? await supabase
        .from("highlights")
        .select("id,video_id,event_id,start_ms,end_ms,title,created_at")
        .in("video_id", videoIds)
        .order("created_at", { ascending: false })
    : { data: [] };

  const { data: diaries } = await supabase
    .from("diary_entries")
    .select("id,entry_date,title,note,created_at")
    .eq("workspace_id", workspace.id)
    .order("entry_date", { ascending: false });

  return (
    <main>
      <SiteHeader email={user.email} />
      <RecordsClient highlights={highlights ?? []} diaries={diaries ?? []} />
    </main>
  );
}
