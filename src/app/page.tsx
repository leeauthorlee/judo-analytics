import Link from "next/link";
import SiteHeader from "@/app/components/site-header";
import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/config";

export default async function Home() {
  let email: string | null = null;
  if (isSupabaseConfigured()) {
    const supabase = await createClient();
    email = (await supabase.auth.getUser()).data.user?.email ?? null;
  }

  return (
    <main>
      <SiteHeader email={email} />

      <section className="hero" id="top">
        <div className="hero-inner">
          <p className="eyebrow">JUDO VIDEO REVIEW</p>
          <h1>기술을 다시 보고,<br />판정의 근거를 확인하다.</h1>
          <p className="hero-description">
            경기 영상에서 기술 장면을 검토하기 위한 분석 도구입니다.<br />
            결과는 공식 심판 판정이 아닌 AI 추정으로 제공됩니다.
          </p>
          <div className="hero-actions">
            <Link className="primary-button" href="/analysis">영상 등록하러 가기</Link>
            <Link className="text-link" href="#how">앱 사용 방법</Link>
          </div>
        </div>
      </section>

      <section className="how-section" id="how">
        <p className="eyebrow">HOW IT WORKS</p>
        <h2>세 단계로 기록을 남깁니다.</h2>
        <div className="how-grid">
          <article>
            <h3>영상 등록</h3>
            <p>권한이 확인된 MP4를 비공개 저장소에 올립니다. 최대 500 MB, 10분 이하.</p>
          </article>
          <article>
            <h3>장면 검토</h3>
            <p>분석 결과의 시간 구간과 기술·점수 후보를 확인하고 하이라이트로 저장합니다.</p>
          </article>
          <article>
            <h3>유도 일기</h3>
            <p>날짜별 기록에 하이라이트를 연결해 나의 훈련 흐름을 남깁니다.</p>
          </article>
        </div>
      </section>

      <footer>
        <p>JUDO ANALYTICS</p>
        <span>AI 분석은 참고용이며 공식 심판 판정이 아닙니다.</span>
      </footer>
    </main>
  );
}
