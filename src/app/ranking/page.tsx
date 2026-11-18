import SiteHeader from "@/app/components/site-header";
import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/config";

export default async function RankingPage() {
  let email: string | null = null;
  if (isSupabaseConfigured()) {
    const supabase = await createClient();
    email = (await supabase.auth.getUser()).data.user?.email ?? null;
  }

  return (
    <main>
      <SiteHeader email={email} />
      <section className="section" id="ranking">
        <div className="section-heading">
          <p className="eyebrow">JUDO RANKING</p>
          <h2>유도 랭킹</h2>
          <p>-score 기준 사용자 순위-</p>
        </div>

        <div className="ranking-layout">
          <div>
            <table className="ranking-table">
              <thead>
                <tr><th scope="col">순위</th><th scope="col">아이디</th><th scope="col">score</th></tr>
              </thead>
              <tbody>
                <tr><td colSpan={3}>랭킹 데이터가 아직 없습니다.</td></tr>
              </tbody>
            </table>
          </div>
          <aside className="rank-panel">
            <p className="eyebrow">MY RANK</p>
            <h3>나의 순위</h3>
            <p className="rank-value">—</p>
            <p className="rank-note">분석 결과가 쌓이면 순위가 표시됩니다.</p>
          </aside>
        </div>
      </section>
    </main>
  );
}
