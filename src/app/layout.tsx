import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Judo Analytics | 유도 영상 분석",
  description: "유도 경기 영상의 기술과 판정 근거를 검토하기 위한 분석 도구입니다.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
