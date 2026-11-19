"use client";

import { useEffect, useState } from "react";

type Row = { rank: number; label: string; points: number; diaryCount: number; isSelf: boolean };
type Self = { rank: number; points: number; diaryCount: number };

export default function RankingBoard({ isGuest }: { isGuest: boolean }) {
  const [rows, setRows] = useState<Row[]>([]);
  const [self, setSelf] = useState<Self | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (isGuest) return;
    let active = true;
    fetch("/api/ranking")
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error ?? "랭킹을 불러오지 못했습니다.");
        if (active) { setRows(data.rows ?? []); setSelf(data.self ?? null); }
      })
      .catch((cause) => { if (active) setError(cause instanceof Error ? cause.message : "랭킹을 불러오지 못했습니다."); });
    return () => { active = false; };
  }, [isGuest]);

  if (isGuest) {
    return <p className="empty-state">랭킹은 로그인 후 이용할 수 있습니다. <a className="text-link" href="/login">로그인하기</a></p>;
  }

  return (
    <div className="ranking-layout">
      <table className="ranking-table">
        <thead><tr><th scope="col">순위</th><th scope="col">사용자</th><th scope="col">총점</th></tr></thead>
        <tbody>
          {error ? <tr><td colSpan={3}>{error}</td></tr>
            : rows.length === 0 ? <tr><td colSpan={3}>등록된 일기가 없어 랭킹이 없습니다.</td></tr>
            : rows.map((row, index) => (
              <tr key={`${row.label}-${index}`} className={row.isSelf ? "is-self" : undefined}>
                <td>{row.rank}위</td><td>{row.label}{row.isSelf ? " (나)" : ""}</td><td>{row.points}점</td>
              </tr>
            ))}
        </tbody>
      </table>
      <aside className="rank-panel">
        <p className="eyebrow">MY RANK</p>
        <h3>나의 랭킹</h3>
        <p className="rank-value">{self && self.rank > 0 ? `${self.rank}위` : "—"}</p>
        <p className="rank-note">총점 {self?.points ?? 0}점</p>
        <p className="rank-note">등록 일기 {self?.diaryCount ?? 0}개</p>
      </aside>
    </div>
  );
}
