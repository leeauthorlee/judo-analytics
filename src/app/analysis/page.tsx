import { redirect } from "next/navigation";
import SiteHeader from "@/app/components/site-header";
import AnalysisClient from "@/app/analysis/analysis-client";
import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/config";

export default async function AnalysisPage() {
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
    .select("id,original_name,size_bytes,status,created_at")
    .eq("workspace_id", workspace.id)
    .is("deleted_at", null)
    .order("created_at", { ascending: false });

  const videoIds = (videos ?? []).map((video) => video.id);
  const { data: analyses } = videoIds.length
    ? await supabase
        .from("video_analyses")
        .select("id,video_id,status,error_code,result_json,created_at")
        .in("video_id", videoIds)
        .order("created_at", { ascending: false })
    : { data: [] };

  return (
    <main>
      <SiteHeader email={user.email} />
      <AnalysisClient userId={user.id} videos={videos ?? []} analyses={analyses ?? []} />
    </main>
  );
}
