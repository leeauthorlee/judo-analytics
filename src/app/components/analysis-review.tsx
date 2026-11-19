"use client";

import { useRef, useState } from "react";
import type { JudoAnalysisEvent } from "@/lib/analysis/types";

export type AnalysisReview = {
  technique_label: string;
  landing_choice: string;
  service_score: string;
};
const techniques = { ippon_seoi_nage: "한팔업어치기", o_goshi: "허리껴치기", osoto_gari: "밭다리후리기",
  uchi_mata: "허벅다리걸기", unsupported: "지원 외 기술", unknown: "확인 불가" };
const landings = { full: "등 전체 접촉 → 한판", partial: "등 일부 접촉 → 절반", none: "등 접촉 없음 → 무득점", unknown: "착지 확인 불가" };
const scores: Record<string, string> = { ippon: "한판", waza_ari: "절반", no_score: "무득점", undetermined: "판단 불가" };

export default function AnalysisReviewForm({ videoId, event, review, onChange }: {
  videoId: string; event: JudoAnalysisEvent; review?: AnalysisReview;
  onChange?: (choice: { technique: string; landing: string }) => void;
}) {
  const player = useRef<HTMLVideoElement>(null);
  const [technique, setTechnique] = useState(review?.technique_label ?? event.techniqueId ?? "");
  const [landing, setLanding] = useState(review?.landing_choice ?? "unknown");
  const [error, setError] = useState("");

  function chooseTechnique(value: string) {
    setTechnique(value);
    onChange?.({ technique: value, landing });
  }
  function chooseLanding(value: string) {
    setLanding(value);
    onChange?.({ technique, landing: value });
  }

  return <div className="model-review">
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
    <div className="review-choices">
      <label>기술 확인<select value={technique} onChange={(e) => chooseTechnique(e.target.value)}>
        {Object.entries(techniques).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
      </select></label>
      <label>착지 확인<select value={landing} onChange={(e) => chooseLanding(e.target.value)}>
        {Object.entries(landings).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
      </select></label>
    </div>
    {error && <p role="alert">{error}</p>}
  </div>;
}
