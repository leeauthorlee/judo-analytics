import Link from "next/link";
import { signOut } from "@/app/login/actions";

export default function SiteHeader({ email }: { email?: string | null }) {
  return (
    <header className="site-header">
      <Link className="wordmark" href="/" aria-label="Judo Analytics 홈">
        JUDO<span>ANALYTICS</span>
      </Link>
      <nav aria-label="주 메뉴">
        <Link href="/analysis">영상 분석</Link>
        <Link href="/records">나의 기록</Link>
        <Link href="/ranking">유도 랭킹</Link>
      </nav>
      <div className="account-menu">
        {email ? (
          <>
            <span className="account-email">{email}</span>
            <form action={signOut}>
              <button className="text-button" type="submit">로그아웃</button>
            </form>
          </>
        ) : (
          <Link className="text-button" href="/login">로그인</Link>
        )}
      </div>
    </header>
  );
}
