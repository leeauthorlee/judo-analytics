"use client";

import { useEffect, useRef, useState, type ChangeEvent, type DragEvent } from "react";
import { upload } from "@vercel/blob/client";
import { useRouter } from "next/navigation";
import AnalysisReviewForm, { type AnalysisReview } from "@/app/components/analysis-review";
import DiaryModal from "@/app/components/diary-modal";
import RankingBoard from "@/app/components/ranking-board";
import type { JudoAnalysisEvent } from "@/lib/analysis/types";
import { isPendingDiary } from "@/lib/diary";
import { POINTS_PER_DIARY, techniqueName } from "@/lib/scoring/policy";

type Video = { id: string; original_name: string; size_bytes: number; status: string; created_at: string };
type AnalysisEvent = JudoAnalysisEvent;
type Analysis = {
  id: string;
  video_id: string;
  status: "queued" | "processing" | "review_required" | "completed" | "failed";
  error_code: string | null;
  created_at: string;
  result_json: { events?: AnalysisEvent[]; provider?: string; providerVersion?: string; disclaimer?: string } | null;
  analysis_reviews?: AnalysisReview | AnalysisReview[] | null;
};
type Diary = { id: string; entry_date: string; title: string; note: string | null; created_at: string; thumbnailUrl: string | null };

const MAX_VIDEO_BYTES = 500 * 1024 * 1024;

function formatSize(size: number) { return `${(size / (1024 * 1024)).toFixed(1)} MB`; }
function formatTime(ms: number) {
  const seconds = Math.floor(ms / 1000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}
function errorText(code: string | null) {
  if (code === "INVALID_ANALYSIS_INTERVAL") return "분석 구간이 올바르지 않습니다. 30초 이내 구간을 선택해 주세요.";
  if (code === "MODEL_NOT_CONFIGURED") return "워커에 모델 파일이 설치되지 않았습니다.";
  if (code === "CANCELLED") return "분석이 취소되었습니다. 새 영상으로 다시 시도해 주세요.";
  return "분석에 실패했습니다. 잠시 후 다시 시도해 주세요.";
}

export default function HomeClient({
  userId,
  email,
  isGuest,
  videos,
  analyses,
  diaries,
}: {
  userId: string;
  email: string | null;
  isGuest: boolean;
  videos: Video[];
  analyses: Analysis[];
  diaries: Diary[];
}) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const previewUrlRef = useRef<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [duration, setDuration] = useState(0);
  const [startSeconds, setStartSeconds] = useState(0);
  const [endSeconds, setEndSeconds] = useState(0);
  const [diaryModal, setDiaryModal] = useState<{ analysisId: string; technique: string } | null>(null);
  const [highlight, setHighlight] = useState<Diary | null>(null);
  const [freshStart, setFreshStart] = useState(false);

  const activeVideo = videos[0] ?? null;
  const activeAnalysis = activeVideo ? analyses.find((item) => item.video_id === activeVideo.id) ?? null : null;
  const review = activeAnalysis
    ? (Array.isArray(activeAnalysis.analysis_reviews) ? activeAnalysis.analysis_reviews[0] : activeAnalysis.analysis_reviews ?? undefined)
    : undefined;
  const confirmedName = review ? (techniqueName(review.technique_label) ?? (review.technique_label === "unsupported" ? "지원 외 기술" : "확인 불가")) : null;
  const points = review ? (techniqueName(review.technique_label) ? POINTS_PER_DIARY : 0) : 0;
  const event = activeAnalysis?.result_json?.events?.[0];
  const isRunning = activeAnalysis?.status === "queued" || activeAnalysis?.status === "processing";

  const phase = busy ? "uploading"
    : file ? "select"
    : freshStart ? "upload"
    : isRunning ? "analyzing"
    : activeAnalysis?.status === "review_required" || activeAnalysis?.status === "completed" ? "complete"
    : activeAnalysis?.status === "failed" ? "failed"
    : "upload";

  const activeVideoIdRef = useRef<string | null>(null);
  useEffect(() => { activeVideoIdRef.current = activeVideo?.id ?? null; }, [activeVideo?.id]);

  useEffect(() => () => { if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current); }, []);

  useEffect(() => {
    if (!isRunning) return;
    const interval = window.setInterval(() => router.refresh(), 6000);
    return () => window.clearInterval(interval);
  }, [isRunning, router]);

  // Best-effort release when leaving the page. The server TTL reaper is the
  // authoritative cleanup for cases where this signal cannot be delivered.
  useEffect(() => {
    const handler = () => {
      const id = activeVideoIdRef.current;
      if (!id || typeof navigator.sendBeacon !== "function") return;
      navigator.sendBeacon("/api/videos/release", new Blob([JSON.stringify({ videoId: id })], { type: "application/json" }));
    };
    window.addEventListener("pagehide", handler);
    return () => window.removeEventListener("pagehide", handler);
  }, []);

  const registeredDiaries = diaries.filter((item) => !isPendingDiary(item.note));
  // Pick once per diary set; keep the previous pick while it still exists so
  // refreshes do not make the highlight flicker between entries.
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      setHighlight((previous) => {
        if (previous && registeredDiaries.some((item) => item.id === previous.id)) return previous;
        return registeredDiaries.length ? registeredDiaries[Math.floor(Math.random() * registeredDiaries.length)] : null;
      });
    });
    return () => cancelAnimationFrame(frame);
  }, [diaries, registeredDiaries]);

  function setSelectedFile(value: File | null) {
    if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
    previewUrlRef.current = value ? URL.createObjectURL(value) : null;
    setPreviewUrl(previewUrlRef.current);
    setFile(value);
    setDuration(0); setStartSeconds(0); setEndSeconds(0);
  }

  function selectFile(value?: File) {
    setError(""); setMessage("");
    if (!value) return;
    if (value.type !== "video/mp4" && !value.name.toLowerCase().endsWith(".mp4")) {
      setSelectedFile(null); setError("MP4 파일만 선택할 수 있습니다."); return;
    }
    if (value.size > MAX_VIDEO_BYTES) {
      setSelectedFile(null); setError("파일 크기는 500 MB 이하여야 합니다."); return;
    }
    setSelectedFile(value);
  }

  function onFileChange(e: ChangeEvent<HTMLInputElement>) {
    selectFile(e.target.files?.[0]); e.target.value = "";
  }
  function onDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault(); setDragging(false); selectFile(e.dataTransfer.files[0]);
  }

  async function createThumbnail(source: File): Promise<File | null> {
    const objectUrl = URL.createObjectURL(source);
    const element = document.createElement("video");
    element.preload = "metadata"; element.muted = true; element.src = objectUrl;
    try {
      await new Promise<void>((resolve, reject) => {
        const timer = window.setTimeout(resolve, 2500);
        element.onloadeddata = () => { window.clearTimeout(timer); resolve(); };
        element.onerror = () => { window.clearTimeout(timer); reject(new Error("thumbnail")); };
      });
      const canvas = document.createElement("canvas");
      canvas.width = 320; canvas.height = 180;
      const context = canvas.getContext("2d");
      if (!context || !element.videoWidth) return null;
      context.drawImage(element, 0, 0, canvas.width, canvas.height);
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.7));
      return blob ? new File([blob], "thumbnail.jpg", { type: "image/jpeg" }) : null;
    } catch { return null; } finally { URL.revokeObjectURL(objectUrl); }
  }

  async function uploadAndQueue() {
    if (!file) return;
    if (!duration || duration > 600 || !Number.isFinite(startSeconds) || !Number.isFinite(endSeconds) ||
        startSeconds < 0 || endSeconds <= startSeconds || endSeconds > duration || endSeconds - startSeconds > 30) {
      setError("10분 이하 영상에서 30초 이내의 공격 구간을 선택해 주세요."); return;
    }
    setFreshStart(false);
    setBusy(true); setError(""); setMessage("");
    try {
      let actorId = userId;
      if (!actorId) {
        const sessionResponse = await fetch("/api/auth/guest", { method: "POST" });
        const session = await sessionResponse.json();
        if (!sessionResponse.ok || typeof session.userId !== "string") {
          throw new Error(session.error ?? "임시 세션을 만들지 못했습니다.");
        }
        actorId = session.userId;
      }
      const pathname = `workspaces/${actorId}/${crypto.randomUUID()}.mp4`;
      await upload(pathname, file, { access: "private", handleUploadUrl: "/api/uploads", contentType: "video/mp4", multipart: true });

      let thumbnailKey: string | null = null;
      const thumb = await createThumbnail(file);
      if (thumb) {
        thumbnailKey = `workspaces/${actorId}/${crypto.randomUUID()}.jpg`;
        await upload(thumbnailKey, thumb, { access: "private", handleUploadUrl: "/api/uploads", contentType: "image/jpeg" });
      }

      const videoResponse = await fetch("/api/videos", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pathname, originalName: file.name }),
      });
      const videoBody = await videoResponse.json();
      if (!videoResponse.ok) throw new Error(videoBody.error ?? "영상 정보를 저장하지 못했습니다.");

      const analysisResponse = await fetch("/api/analyses", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          videoId: videoBody.video.id, thumbnailKey,
          startMs: Math.round(startSeconds * 1000), endMs: Math.round(endSeconds * 1000),
        }),
      });
      const analysisBody = await analysisResponse.json();
      if (!analysisResponse.ok) throw new Error(analysisBody.error ?? "분석 작업을 등록하지 못했습니다.");

      setSelectedFile(null);
      setMessage("AI가 선택 구간을 분석하고 있습니다. 결과는 이 화면에 표시됩니다.");
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "업로드 또는 분석 요청에 실패했습니다.");
    } finally { setBusy(false); }
  }

  async function deleteDiary(id: string) {
    if (!window.confirm("이 일기를 삭제할까요? 등록된 랭킹 점수도 함께 반영됩니다.")) return;
    setError(""); setMessage("");
    const response = await fetch(`/api/diaries/${id}`, { method: "DELETE" });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) { setError(result.error ?? "일기를 삭제하지 못했습니다."); return; }
    setMessage("일기를 삭제했습니다. 랭킹 점수가 다시 집계됩니다.");
    router.refresh();
  }

  async function startNewAnalysis() {
    setError(""); setMessage("");
    const response = await fetch("/api/videos", { method: "DELETE" });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
      setError(result.error ?? "이전 영상을 삭제하지 못했습니다. 결과를 유지합니다.");
      return;
    }
    setSelectedFile(null);
    setDiaryModal(null);
    setFreshStart(true);
    setMessage("이전 영상과 분석 결과를 정리했습니다. 새 영상을 선택해 주세요.");
    router.refresh();
  }

  return (
    <>
      <section className="hero" id="top">
        <div className="hero-copy">
          <p className="eyebrow">JUDO VIDEO REVIEW</p>
          <h1>기술을 다시 보고,<br />착지를 직접 확인하다.</h1>
          <p className="hero-description">
            선택한 공격 구간에서 AI가 기술 후보를 추천합니다.<br />
            착지와 득점은 영상을 보고 직접 확인합니다.
          </p>
          <a className="primary-button" href="#analysis">영상 선택하기</a>
        </div>
        <div className="hero-mark" aria-hidden="true"><span>柔</span><i /></div>
      </section>

      {error && <p className="feedback error" role="alert">{error}</p>}
      {message && <p className="feedback notice" role="status">{message}</p>}

      <section className="section" id="analysis">
        <div className="section-heading">
          <p className="eyebrow">VIDEO ANALYSIS</p>
          <h2>영상 분석</h2>
          <p>MP4 · 최대 500 MB · 10분 이하 · 한 번의 공격 구간을 30초 이내로 선택</p>
        </div>

        <div className="analysis-stage" aria-live="polite">
          {phase === "analyzing" && (
            <div className="stage-card">
              <div className="spinner" aria-hidden="true" />
              <h3>분석 중입니다</h3>
              <p>선택한 구간에서 기술 후보를 추천하고 있습니다. 잠시만 기다려 주세요.</p>
              <p className="stage-note">진행률을 표시하지 않습니다. 분석이 끝나면 이 화면에 결과가 나타납니다.</p>
            </div>
          )}

          {phase === "failed" && (
            <div className="stage-card">
              <h3>분석에 실패했습니다</h3>
              <p role="alert">{errorText(activeAnalysis?.error_code ?? null)}</p>
              <div className="button-row">
                <button className="secondary-button" type="button" onClick={() => void startNewAnalysis()}>새로운 영상 분석하기</button>
              </div>
            </div>
          )}

          {(phase === "upload" || phase === "uploading") && (
            <div className={`drop-zone${dragging ? " is-dragging" : ""}`}
              onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
              onDragLeave={() => setDragging(false)} onDrop={onDrop}>
              <input ref={inputRef} className="sr-only" type="file" accept="video/mp4,.mp4" onChange={onFileChange} />
              <div className="upload-icon" aria-hidden="true">↑</div>
              <h3>파일 업로드</h3>
              <p>분석할 영상을 끌어 놓거나 선택하세요.</p>
              <button className="secondary-button" type="button" disabled={busy} onClick={() => inputRef.current?.click()}>파일 선택</button>
            </div>
          )}

          {phase === "select" && file && (
            <div className="selected-video">
              <div className="selected-video-info"><strong>{file.name}</strong><span>{formatSize(file.size)}</span></div>
              {previewUrl && <video className="preview" src={previewUrl} controls preload="metadata"
                onLoadedMetadata={(e) => {
                  const seconds = e.currentTarget.duration;
                  if (Number.isFinite(seconds)) { setDuration(seconds); setEndSeconds(Math.floor(Math.min(seconds, 30) * 1000) / 1000); }
                }} onError={() => setError("영상 메타데이터를 읽을 수 없습니다.")} />}
              <div className="interval-inputs">
                <label>시작 (초)<input type="number" min="0" step="0.001" value={startSeconds} onChange={(e) => setStartSeconds(Number(e.target.value))} /></label>
                <label>종료 (초)<input type="number" min="0" max={duration || undefined} step="0.001" value={endSeconds} onChange={(e) => setEndSeconds(Number(e.target.value))} /></label>
              </div>
              <div className="button-row">
                <button className="primary-button" type="button" disabled={busy} onClick={() => void uploadAndQueue()}>분석 요청</button>
                <button className="secondary-button" type="button" disabled={busy} onClick={() => setSelectedFile(null)}>취소</button>
              </div>
            </div>
          )}

          {phase === "complete" && activeAnalysis && activeVideo && (
            <div className="result-card">
              <p className="eyebrow">분석 완료</p>
              <div className="result-outcome">
                <div>
                  <span className="result-label">최종 판단 기술</span>
                  <strong className="result-technique">{confirmedName ?? "확인 전"}</strong>
                </div>
                <div>
                  <span className="result-label">획득 랭킹 점수</span>
                  <strong className="result-points">{points > 0 ? `+${points}점` : "0점"}</strong>
                  <span className="point-note">일기 등록 시 적립 · 분석만으로는 반영되지 않습니다</span>
                </div>
              </div>

              <div className="result-section">
                <h4>AI 추천 결과 <small>모델 점수 · 확정 아님</small></h4>
                <ol className="candidate-list">
                  {(event?.techniqueCandidates ?? []).map((candidate) => (
                    <li key={candidate.techniqueId}>
                      <span>{techniqueName(candidate.techniqueId) ?? candidate.techniqueId}</span>
                      <span>{(candidate.modelScore * 100).toFixed(1)}</span>
                    </li>
                  ))}
                </ol>
                <p className="result-note">분석 구간 {formatTime(event?.startMs ?? 0)}–{formatTime(event?.endMs ?? 0)} · 위 점수는 보정되지 않은 모델 점수이며 랭킹 점수와 다릅니다.</p>
              </div>

              <div className="result-section">
                <h4>사용자 최종 확인</h4>
                <AnalysisReviewForm analysisId={activeAnalysis.id} videoId={activeVideo.id} event={event ?? {
                  startMs: 0, endMs: 0, techniqueId: null, score: "uncertain", toriRole: "unknown", ukeRole: "unknown",
                  observations: [], missingEvidence: [], confidenceBand: "low",
                }} review={review} />
              </div>
              <p className="disclaimer">{activeAnalysis.result_json?.disclaimer ?? "experiment model · 공식 심판 판정이 아닙니다."}</p>

              <div className="button-row result-actions">
                <button className="primary-button" type="button" disabled={!confirmedName || points === 0}
                  onClick={() => setDiaryModal(isGuest ? null : { analysisId: activeAnalysis.id, technique: confirmedName ?? "" })}>
                  일기에 등록하기
                </button>
                <button className="secondary-button" type="button" onClick={() => void startNewAnalysis()}>새로운 영상 분석하기</button>
              </div>
              {isGuest && confirmedName && (
                <p className="result-note">일기 등록과 랭킹은 <a className="text-link" href="/login">로그인</a> 후 이용할 수 있습니다.</p>
              )}
            </div>
          )}
        </div>
      </section>

      {diaryModal && (
        <DiaryModal
          technique={diaryModal.technique}
          analysisId={diaryModal.analysisId}
          onClose={() => setDiaryModal(null)}
          onSaved={(text) => { setDiaryModal(null); setMessage(text); router.refresh(); }}
        />
      )}

      <section className="section" id="diary">
        <div className="section-heading">
          <p className="eyebrow">TRAINING DIARY</p>
          <h2>유도 일기</h2>
        </div>
        {isGuest ? (
          <p className="empty-state">일기는 <a className="text-link" href="/login">로그인</a> 후 이용할 수 있습니다.</p>
        ) : (
          <>
            <h3 className="subheading">오늘의 하이라이트</h3>
            {highlight ? (
              <article className="diary-entry highlight-card">
                <span>{highlight.entry_date}</span>
                <h4>{highlight.title}</h4>
                {highlight.note && <p>{highlight.note}</p>}
                <span>+{POINTS_PER_DIARY}점</span>
              </article>
            ) : (
              <p className="empty-state">등록된 일기가 없습니다. 분석 결과를 일기에 등록해 보세요.</p>
            )}
            <h3 className="subheading">내 일기</h3>
            {registeredDiaries.length === 0 ? (
              <p className="empty-state">아직 등록된 일기가 없습니다.</p>
            ) : (
              <div className="diary-list">
                {registeredDiaries.map((diary) => (
                  <article className="diary-entry" key={diary.id}>
                    <span>{diary.entry_date}</span>
                    <h4>{diary.title}</h4>
                    {diary.note && <p>{diary.note}</p>}
                    <span className="diary-points">+{POINTS_PER_DIARY}점</span>
                    <button className="text-button" type="button" onClick={() => void deleteDiary(diary.id)}>일기 삭제</button>
                  </article>
                ))}
              </div>
            )}
          </>
        )}
      </section>

      <section className="section" id="ranking">
        <div className="section-heading">
          <p className="eyebrow">JUDO RANKING</p>
          <h2>유도 랭킹</h2>
          <p>일기 1건당 {POINTS_PER_DIARY}점 · 등록된 일기 합계 기준</p>
        </div>
        <RankingBoard isGuest={isGuest} />
      </section>

      <footer>
        <span>{email ?? "비회원"} · {isGuest ? "임시 세션" : "회원"}</span>
        <span>AI 분석은 참고용이며 공식 심판 판정이 아닙니다.</span>
      </footer>
    </>
  );
}
