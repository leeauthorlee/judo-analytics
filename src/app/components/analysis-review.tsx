"use client";

import { useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import type { JudoAnalysisEvent } from "@/lib/analysis/types";
import { techniqueName } from "@/lib/scoring/policy";

export type AnalysisReview = {
  technique_label: string;
  landing_choice: string;
  service_score: string;
};
const techniques = { ippon_seoi_nage: "한팔업어치기", o_goshi: "허리껴치기", osoto_gari: "밭다리후리기",
  uchi_mata: "허벅다리걸기", unsupported: "지원 외 기술", unknown: "확인 불가" };
const landings = { full: "등 전체 접촉 → 한판", partial: "등 일부 접촉 → 절반", none: "등 접촉 없음 → 무득점", unknown: "착지 확인 불가" };
const scores: Record<string, string> = { ippon: "한판", waza_ari: "절반", no_score: "무득점", undetermined: "판단 불가" };

export default function AnalysisReviewForm({ analysisId, videoId, event, review, onSaved }: {
  analysisId: string; videoId: string; event: JudoAnalysisEvent; review?: AnalysisReview;
  onSaved?: (review: AnalysisReview) => void;
}) {
  const router = useRouter();
  const player = useRef<HTMLVideoElement>(null);
  const [technique, setTechnique] = useState(review?.technique_label ?? event.techniqueId ?? "");
  const [landing, setLanding] = useState(review?.landing_choice ?? "");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  async function save(e: FormEvent) {
    e.preventDefault(); setBusy(true); setError(""); setMessage("");
    try {
      const response = await fetch(`/api/analyses/${analysisId}`, { method: "PATCH",
        headers: { "Content-Type": "application/json" }, body: JSON.stringify({ technique, landing }) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "확인 결과를 저장하지 못했습니다.");
      setMessage("사용자 확인 결과를 저장했습니다.");
      if (onSaved) onSaved(body.review as AnalysisReview); else router.refresh();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "저장 실패"); }
    finally { setBusy(false); }
  }
  return <div className="model-review">
    <strong>AI 판단 기술</strong>
    <p className="ai-final">{techniqueName(event.techniqueId) ?? "판별 불가"}</p>
    <p>AI 결과가 기술 확인에 기본 반영됩니다. 화면에서 직접 바꿀 수 있습니다.</p>
    <video ref={player} className="preview" controls preload="metadata"
      src={`/api/videos/${videoId}/media#t=${event.startMs / 1000},${event.endMs / 1000}`}
      onLoadedMetadata={(e) => { e.currentTarget.currentTime = event.startMs / 1000; }}
      onTimeUpdate={(e) => { if (e.currentTarget.currentTime >= event.endMs / 1000) e.currentTarget.pause(); }} />
    <div className="review-playback">
      <button type="button" className="secondary-button" onClick={() => {
        if (player.current) { player.current.currentTime = event.startMs / 1000; void player.current.play().catch(() => setError("재생 버튼으로 영상을 확인해 주세요.")); }
      }}>선택 구간 다시 보기</button>
      <label>재생 속도 <select defaultValue="1" onChange={(e) => { if (player.current) player.current.playbackRate = Number(e.target.value); }}>
        <option value="1">1배</option><option value="0.5">0.5배</option><option value="0.25">0.25배</option>
      </select></label>
    </div>
    <p>사용자 확인 득점: {review ? scores[review.service_score] ?? "판단 불가" : "미확인"}</p>
    <form className="form-panel" onSubmit={(e) => void save(e)}>
      <label>기술 확인<select value={technique} onChange={(e) => setTechnique(e.target.value)} required>
        <option value="" disabled>직접 확인 후 선택</option>
        {Object.entries(techniques).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
      </select></label>
      <label>착지 확인<select value={landing} onChange={(e) => setLanding(e.target.value)} required>
        <option value="" disabled>직접 확인 후 선택</option>
        {Object.entries(landings).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
      </select></label>
      <p>등 접촉 기준의 서비스 기록이며, 랭킹 점수와는 별개입니다. 공식 판정이 아닙니다.</p>
      <button className="primary-button" disabled={busy || !technique || !landing}>{busy ? "저장 중…" : "확인 결과 저장"}</button>
      {error && <p role="alert">{error}</p>}{message && <p role="status">{message}</p>}
    </form>
  </div>;
}
