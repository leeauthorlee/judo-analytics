import { redirect } from "next/navigation";
import Link from "next/link";
import { signInWithProvider } from "@/app/login/actions";
import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { isGuestUser } from "@/lib/access";
import GuestLoginButton from "@/app/login/guest-login-button";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  if (isSupabaseConfigured()) {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (user && !isGuestUser(user)) redirect("/");
  }

  const loginErrors: Record<string, string> = {
    callback: "OAuth 로그인을 완료하지 못했습니다. 제공자 설정과 허용된 콜백 URL을 확인해 주세요.",
    configuration: "Supabase 환경변수 설정이 필요합니다.",
    oauth: "로그인 제공자 설정을 확인해 주세요.",
    provider: "지원하지 않는 로그인 방식입니다.",
  };
  const errorMessage = error ? loginErrors[error] : undefined;

  return (
    <main className="auth-page">
      <Link className="wordmark auth-wordmark" href="/">JUDO<span>ANALYTICS</span></Link>
      <section className="auth-card">
        <p className="eyebrow">JUDO VIDEO REVIEW</p>
        <h1>로그인하고 분석을 시작하세요.</h1>
        <p>영상과 분석 결과는 로그인한 계정의 비공개 작업공간에 저장됩니다.</p>

        {errorMessage && <p className="feedback error" role="alert">{errorMessage}</p>}

        {!isSupabaseConfigured() ? (
          <div className="feedback error" role="status">
            Supabase 연결 설정이 필요합니다. 배포 안내 문서의 환경변수를 먼저 등록해 주세요.
          </div>
        ) : (
          <div className="auth-actions">
            <form action={signInWithProvider}>
              <input type="hidden" name="provider" value="google" />
              <button className="primary-button" type="submit">Google로 계속</button>
            </form>
            <form action={signInWithProvider}>
              <input type="hidden" name="provider" value="kakao" />
              <button className="secondary-button" type="submit">Kakao로 계속</button>
            </form>
            <GuestLoginButton />
          </div>
        )}

        <p className="auth-note">AI 결과는 참고용 추정이며 공식 심판 판정이 아닙니다.</p>
      </section>
    </main>
  );
}
