"use client";

import { useEffect, useRef, useState, type ChangeEvent, type DragEvent, type FormEvent } from "react";
import { upload } from "@vercel/blob/client";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { signOut } from "@/app/login/actions";

type Analysis = {
  id: string;
  video_id: string;
  status: "queued" | "processing" | "review_required" | "completed" | "failed";
  error_code: string | null;
  created_at: string;
  result_json: { events?: AnalysisEvent[] } | null;
};

type AnalysisEvent = {
  eventId?: string;
  startMs: number;
  endMs: number;
  techniqueId: string | null;
  score: "ippon" | "waza_ari" | "yuko" | "no_score" | "uncertain";
  toriRole: "blue" | "white" | "unknown";
  ukeRole: "blue" | "white" | "unknown";
  observations: string[];
  missingEvidence: string[];
  confidenceBand: "low" | "medium" | "high";
};

type Highlight = {
  id: string;
  video_id: string;
  event_id: string | null;
  start_ms: number;
  end_ms: number;
  title: string;
  created_at: string;
};

type Diary = {
  id: string;
  entry_date: string;
  title: string;
  note: string | null;
  created_at: string;
};

type Video = {
  id: string;
  original_name: string;
  size_bytes: number;
  status: string;
  created_at: string;
};

const MAX_VIDEO_BYTES = 500 * 1024 * 1024;

function formatSize(size: number) {
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function statusLabel(status: Analysis["status"]) {
  return {
    queued: "대기 중",
    processing: "분석 중",
    review_required: "검토 필요",
    completed: "완료",
    failed: "실패",
  }[status];
}

function formatTime(ms: number) {
  const seconds = Math.floor(ms / 1000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

function scoreLabel(score: AnalysisEvent["score"]) {
  return { ippon: "한판", waza_ari: "절반", yuko: "유효", no_score: "무득점", uncertain: "불확실" }[score];
}

export default function DashboardClient({
  userId,
  email,
  videos,
  analyses,
  highlights,
  diaries,
}: {
  userId: string;
  email: string;
  videos: Video[];
  analyses: Analysis[];
  highlights: Highlight[];
  diaries: Diary[];
}) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const previewUrlRef = useRef<string | null>(null);
  const [video, setVideo] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [savingEventId, setSavingEventId] = useState<string | null>(null);
  const [entryDate, setEntryDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [diaryTitle, setDiaryTitle] = useState("");
  const [diaryNote, setDiaryNote] = useState("");
  const [selectedHighlightIds, setSelectedHighlightIds] = useState<string[]>([]);

  useEffect(() => () => {
    if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
  }, []);

  useEffect(() => {
    if (!analyses.some((item) => item.status === "queued" || item.status === "processing")) return;
    const interval = window.setInterval(() => router.refresh(), 8000);
    return () => window.clearInterval(interval);
  }, [analyses, router]);

  function setSelectedVideo(file: File | null) {
    if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
    previewUrlRef.current = file ? URL.createObjectURL(file) : null;
    setPreviewUrl(previewUrlRef.current);
    setVideo(file);
  }

  function selectVideo(file?: File) {
    setError("");
    setMessage("");
    if (!file) return;
    if (file.type !== "video/mp4" && !file.name.toLowerCase().endsWith(".mp4")) {
      setSelectedVideo(null);
      setError("MP4 파일만 선택할 수 있습니다.");
      return;
    }
    if (file.size > MAX_VIDEO_BYTES) {
      setSelectedVideo(null);
      setError("파일 크기는 500 MB 이하여야 합니다.");
      return;
    }
    setSelectedVideo(file);
  }

  function onFileChange(event: ChangeEvent<HTMLInputElement>) {
    selectVideo(event.target.files?.[0]);
    event.target.value = "";
  }

  function onDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragging(false);
    selectVideo(event.dataTransfer.files[0]);
  }

  async function uploadAndQueue() {
    if (!video) return;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const pathname = `workspaces/${userId}/${crypto.randomUUID()}.mp4`;
      const blob = await upload(pathname, video, {
        access: "private",
        handleUploadUrl: "/api/uploads",
        contentType: "video/mp4",
        multipart: true,
      });
      const videoResponse = await fetch("/api/videos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pathname: blob.pathname, originalName: video.name }),
      });
      const videoBody = await videoResponse.json();
      if (!videoResponse.ok) throw new Error(videoBody.error ?? "영상 정보를 저장하지 못했습니다.");

      const analysisResponse = await fetch("/api/analyses", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ videoId: videoBody.video.id }),
      });
      const analysisBody = await analysisResponse.json();
      if (!analysisResponse.ok) throw new Error(analysisBody.error ?? "분석 작업을 등록하지 못했습니다.");

      setMessage(
        analysisBody.analysis.dispatchStatus === "worker_not_configured"
          ? "영상은 저장되었고 분석 작업도 DB에 등록했습니다. Google Cloud Tasks/Run을 연결하면 워커가 처리합니다."
          : "영상 저장 및 분석 작업 등록이 완료되었습니다.",
      );
      setSelectedVideo(null);
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "업로드 또는 작업 등록에 실패했습니다.");
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function saveHighlight(videoId: string, event: AnalysisEvent) {
    if (!event.eventId) return;
    setSavingEventId(event.eventId);
    setError("");
    try {
      const response = await fetch("/api/highlights", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          videoId,
          eventId: event.eventId,
          startMs: event.startMs,
          endMs: event.endMs,
          title: `${formatTime(event.startMs)} ${event.techniqueId ?? "유도 기술 장면"}`,
        }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "하이라이트를 저장하지 못했습니다.");
      setMessage("하이라이트를 저장했습니다.");
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "하이라이트 저장에 실패했습니다.");
    } finally {
      setSavingEventId(null);
    }
  }

  async function saveDiary(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setMessage("");
    try {
      const response = await fetch("/api/diaries", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          entryDate,
          title: diaryTitle,
          note: diaryNote,
          highlightIds: selectedHighlightIds,
        }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "일기를 저장하지 못했습니다.");
      setDiaryTitle("");
      setDiaryNote("");
      setSelectedHighlightIds([]);
      setMessage("일기를 저장했습니다.");
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "일기 저장에 실패했습니다.");
    }
  }

  async function deleteVideo(video: Video) {
    if (!window.confirm(`'${video.original_name}' 영상과 연결된 기록을 삭제할까요?`)) return;
    setError("");
    try {
      const response = await fetch(`/api/videos/${video.id}`, { method: "DELETE" });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "영상을 삭제하지 못했습니다.");
      setMessage("영상과 연결된 분석·하이라이트를 삭제했습니다.");
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "영상 삭제에 실패했습니다.");
    }
  }

  const latestAnalysis = new Map<string, Analysis>();
  for (const item of analyses) if (!latestAnalysis.has(item.video_id)) latestAnalysis.set(item.video_id, item);

  return (
    <main>
      <header className="site-header">
        <Link className="wordmark" href="/" aria-label="Judo Analytics 홈">JUDO<span>ANALYTICS</span></Link>
        <nav aria-label="주 메뉴"><a href="#analysis">영상 분석</a><a href="#history">작업 내역</a><a href="#diary">유도 일기</a></nav>
        <div className="account-menu"><span>{email}</span><form action={signOut}><button className="text-button" type="submit">로그아웃</button></form></div>
      </header>

      <section className="hero" id="top">
        <div className="hero-copy">
          <p className="eyebrow">JUDO VIDEO REVIEW</p>
          <h1>기술을 다시 보고,<br />판정의 근거를 확인하다.</h1>
          <p className="hero-description">경기 영상에서 기술 장면을 검토하기 위한 분석 도구입니다.<br />결과는 공식 심판 판정이 아닌 AI 추정으로 제공됩니다.</p>
          <a className="primary-button" href="#analysis">영상 선택하기</a>
        </div>
        <div className="hero-mark" aria-hidden="true"><span>柔</span><i /></div>
      </section>

      <section className="analysis-section" id="analysis">
        <div className="section-heading"><div><p className="eyebrow">VIDEO ANALYSIS</p><h2>경기 영상 분석</h2></div><p>MP4 · 최대 500 MB · 10분</p></div>
        <div
          className={`drop-zone${dragging ? " is-dragging" : ""}`}
          onDragOver={(event) => { event.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
        >
          <input ref={inputRef} className="sr-only" type="file" accept="video/mp4,.mp4" onChange={onFileChange} />
          <div className="upload-icon" aria-hidden="true">↑</div>
          <h3>분석할 영상을 선택하세요</h3>
          <p>사용 권한이 있는 MP4만 업로드하세요. 최대 크기 500 MB.</p>
          <button className="secondary-button" type="button" onClick={() => inputRef.current?.click()}>파일 선택</button>
        </div>
        {video && (
          <div className="selected-video">
            <div className="video-info"><span className="file-icon">MP4</span><div><strong>{video.name}</strong><span>{formatSize(video.size)}</span></div><button className="text-button" onClick={() => setSelectedVideo(null)}>제거</button></div>
            {previewUrl && <video className="preview" src={previewUrl} controls preload="metadata" />}
            <button className="primary-button analyze-button" disabled={busy} onClick={() => void uploadAndQueue()}>{busy ? "업로드 및 등록 중…" : "비공개 업로드 및 분석 요청"}</button>
          </div>
        )}
        {error && <p className="feedback error" role="alert">{error}</p>}
        {message && <p className="feedback notice" role="status">{message}</p>}
      </section>

      <section className="history-section" id="history">
        <div className="section-heading"><div><p className="eyebrow">YOUR WORKSPACE</p><h2>최근 영상과 분석 작업</h2></div></div>
        {videos.length === 0 ? <p className="empty-state">아직 업로드한 영상이 없습니다.</p> : (
          <div className="video-list">
            {videos.map((item) => {
              const analysis = latestAnalysis.get(item.id);
              return <article className="video-row" key={item.id}>
                <div className="file-icon">MP4</div>
                <div className="video-row-info"><strong>{item.original_name}</strong><span>{formatSize(item.size_bytes)} · {new Date(item.created_at).toLocaleString("ko-KR")}</span></div>
                <div className={`status-chip status-${analysis?.status ?? "uploaded"}`}>{analysis ? statusLabel(analysis.status) : "업로드 완료"}</div>
                <button className="text-button delete-video" type="button" onClick={() => void deleteVideo(item)}>삭제</button>
                {analysis?.error_code === "MODEL_NOT_CONFIGURED" && <p className="row-note">분석 워커에 모델이 아직 연결되지 않았습니다.</p>}
                {analysis?.error_code === "WORKER_NOT_CONFIGURED" && <p className="row-note">Cloud Tasks/Run을 연결하면 대기 중인 작업이 처리됩니다.</p>}
                {analysis?.error_code === "TASK_ENQUEUE_FAILED" && <p className="row-note">작업 서버 연결 설정을 확인해 주세요.</p>}
                {analysis?.error_code === "VIDEO_TOO_LONG" && <p className="row-note">영상 길이는 10분 이하여야 합니다.</p>}
                {analysis?.error_code === "INVALID_VIDEO" && <p className="row-note">실제 MP4 영상인지 확인할 수 없습니다.</p>}
                {analysis?.error_code === "WORKER_FAILED" && <p className="row-note">영상 작업에 실패했습니다. 서버 로그를 확인한 뒤 재시도해야 합니다.</p>}
                {analysis?.result_json?.events?.map((event, index) => (
                  <div className="analysis-event" key={event.eventId ?? `${item.id}-${index}`}>
                    <div><strong>{formatTime(event.startMs)}–{formatTime(event.endMs)}</strong><span>{event.techniqueId ?? "기술 판별 불가"} · {scoreLabel(event.score)} · 신뢰도 {event.confidenceBand}</span></div>
                    {event.eventId && !highlights.some((highlight) => highlight.event_id === event.eventId) && (
                      <button className="secondary-button" type="button" disabled={savingEventId === event.eventId} onClick={() => void saveHighlight(item.id, event)}>
                        {savingEventId === event.eventId ? "저장 중…" : "하이라이트 저장"}
                      </button>
                    )}
                  </div>
                ))}
              </article>;
            })}
          </div>
        )}
        <p className="disclaimer">분석 모델은 추후 연결할 수 있도록 워커 인터페이스만 준비되어 있습니다. 점수 후보는 공식 심판 판정이 아닙니다.</p>
      </section>

      <section className="diary-section" id="diary">
        <div className="section-heading"><div><p className="eyebrow">TRAINING DIARY</p><h2>유도 일기</h2></div></div>
        <form className="diary-form" onSubmit={(event) => void saveDiary(event)}>
          <label>날짜<input type="date" value={entryDate} onChange={(event) => setEntryDate(event.target.value)} required /></label>
          <label>제목<input value={diaryTitle} onChange={(event) => setDiaryTitle(event.target.value)} maxLength={120} required /></label>
          <label>메모<textarea value={diaryNote} onChange={(event) => setDiaryNote(event.target.value)} maxLength={4000} rows={3} /></label>
          {highlights.length > 0 && <fieldset><legend>일기에 연결할 하이라이트</legend>{highlights.map((highlight) => <label className="highlight-choice" key={highlight.id}><input type="checkbox" checked={selectedHighlightIds.includes(highlight.id)} onChange={(event) => setSelectedHighlightIds((selected) => event.target.checked ? [...selected, highlight.id] : selected.filter((id) => id !== highlight.id))} />{highlight.title}</label>)}</fieldset>}
          <button className="primary-button" type="submit" disabled={!diaryTitle.trim()}>일기 저장</button>
        </form>
        <div className="diary-list">{diaries.map((diary) => <article className="diary-entry" key={diary.id}><span>{diary.entry_date}</span><h3>{diary.title}</h3>{diary.note && <p>{diary.note}</p>}</article>)}</div>
      </section>

      <footer><p>JUDO ANALYTICS</p><span>영상은 비공개로 저장되며 사용자별 작업공간으로 분리됩니다.</span></footer>
    </main>
  );
}
