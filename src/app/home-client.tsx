"use client";

import { useEffect, useRef, useState, type ChangeEvent, type DragEvent, type FormEvent } from "react";
import { upload } from "@vercel/blob/client";
import { useRouter } from "next/navigation";

type Video = {
  id: string;
  original_name: string;
  size_bytes: number;
  status: string;
  created_at: string;
};

type AnalysisEvent = {
  eventId?: string;
  startMs: number;
  endMs: number;
  techniqueId: string | null;
  score: "ippon" | "waza_ari" | "yuko" | "no_score" | "uncertain";
  confidenceBand: "low" | "medium" | "high";
  observations?: string[];
  missingEvidence?: string[];
};

type Analysis = {
  id: string;
  video_id: string;
  status: "queued" | "processing" | "review_required" | "completed" | "failed";
  error_code: string | null;
  created_at: string;
  result_json: { events?: AnalysisEvent[] } | null;
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
  thumbnailUrl: string | null;
};

const MAX_VIDEO_BYTES = 500 * 1024 * 1024;

function formatSize(size: number) {
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function formatTime(ms: number) {
  const seconds = Math.floor(ms / 1000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

function scoreLabel(score: AnalysisEvent["score"]) {
  return { ippon: "한판", waza_ari: "절반", yuko: "유효", no_score: "무득점", uncertain: "불확실" }[score];
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

export default function HomeClient({
  userId,
  videos,
  analyses,
  highlights,
  diaries,
}: {
  userId: string;
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
  const [selectedDate, setSelectedDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [entryDate, setEntryDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [diaryTitle, setDiaryTitle] = useState("");
  const [diaryNote, setDiaryNote] = useState("");
  const [selectedHighlightIds, setSelectedHighlightIds] = useState<string[]>([]);
  const [temporaryResult, setTemporaryResult] = useState<Analysis["result_json"]>(null);

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

  async function createThumbnail(source: File): Promise<File | null> {
    const objectUrl = URL.createObjectURL(source);
    const element = document.createElement("video");
    element.preload = "metadata";
    element.muted = true;
    element.src = objectUrl;
    try {
      await new Promise<void>((resolve, reject) => {
        const timer = window.setTimeout(resolve, 2500);
        element.onloadeddata = () => { window.clearTimeout(timer); resolve(); };
        element.onerror = () => { window.clearTimeout(timer); reject(new Error("thumbnail")); };
      });
      const canvas = document.createElement("canvas");
      canvas.width = 320;
      canvas.height = 180;
      const context = canvas.getContext("2d");
      if (!context || !element.videoWidth) return null;
      context.drawImage(element, 0, 0, canvas.width, canvas.height);
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.7));
      return blob ? new File([blob], "thumbnail.jpg", { type: "image/jpeg" }) : null;
    } catch {
      return null;
    } finally {
      URL.revokeObjectURL(objectUrl);
    }
  }

  async function uploadAndQueue() {
    if (!video) return;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const pathname = `workspaces/${userId}/${crypto.randomUUID()}.mp4`;
      await upload(pathname, video, {
        access: "private",
        handleUploadUrl: "/api/uploads",
        contentType: "video/mp4",
        multipart: true,
      });

      let thumbnailKey: string | null = null;
      try {
        const thumb = await createThumbnail(video);
        if (thumb) {
          thumbnailKey = `workspaces/${userId}/${crypto.randomUUID()}.jpg`;
          await upload(thumbnailKey, thumb, {
            access: "private",
            handleUploadUrl: "/api/uploads",
            contentType: "image/jpeg",
          });
        }
      } catch {
        thumbnailKey = null;
      }

      const videoResponse = await fetch("/api/videos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pathname, originalName: video.name }),
      });
      const videoBody = await videoResponse.json();
      if (!videoResponse.ok) throw new Error(videoBody.error ?? "영상 정보를 저장하지 못했습니다.");

      const analysisResponse = await fetch("/api/analyses", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ videoId: videoBody.video.id, thumbnailKey }),
      });
      const analysisBody = await analysisResponse.json();
      if (!analysisResponse.ok) throw new Error(analysisBody.error ?? "분석 작업을 등록하지 못했습니다.");

      setTemporaryResult(analysisBody.result ?? null);
      setMessage(
        analysisBody.autoSavedDiaryId
          ? "판단 불가 결과와 점수, 썸네일이 일기에 자동 저장되었습니다."
          : "영상 저장 및 분석 요청이 완료되었습니다.",
      );
      setSelectedVideo(null);
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "업로드 또는 작업 등록에 실패했습니다.");
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
    setBusy(true);
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
    } finally {
      setBusy(false);
    }
  }

  async function deleteVideo(video: Video) {
    if (!window.confirm(`'${video.original_name}' 영상과 연결된 기록을 삭제할까요?`)) return;
    setError("");
    try {
      const response = await fetch(`/api/videos/${video.id}`, { method: "DELETE" });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "영상을 삭제하지 못했습니다.");
      setMessage("영상과 연결된 기록을 삭제했습니다.");
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "영상 삭제에 실패했습니다.");
    }
  }

  const latestAnalysis = new Map<string, Analysis>();
  for (const item of analyses) if (!latestAnalysis.has(item.video_id)) latestAnalysis.set(item.video_id, item);

  const dayHighlights = highlights.filter((item) => item.created_at.slice(0, 10) === selectedDate);

  return (
    <>
      <section className="hero" id="top">
        <div className="hero-copy">
          <p className="eyebrow">JUDO VIDEO REVIEW</p>
          <h1>기술을 다시 보고,<br />판정의 근거를 확인하다.</h1>
          <p className="hero-description">
            경기 영상에서 기술 장면을 검토하기 위한 분석 도구입니다.<br />
            결과는 공식 심판 판정이 아닌 AI 추정으로 제공됩니다.
          </p>
          <a className="primary-button" href="#analysis">영상 선택하기</a>
        </div>
        <div className="hero-mark" aria-hidden="true"><span>柔</span><i /></div>
      </section>

      {error && <p className="feedback error" role="alert">{error}</p>}
      {message && <p className="feedback notice" role="status">{message}</p>}

      {temporaryResult?.events?.map((event, index) => (
        <section className="section temporary-result" key={index}>
          <div className="section-heading">
            <p className="eyebrow">ANALYSIS RESULT</p>
            <h2>판정 결과</h2>
          </div>
          <div className="result-card">
            <strong>판단 불가</strong>
            <span>점수: {scoreLabel(event.score)} · 신뢰도 {event.confidenceBand}</span>
            <p>{event.observations?.[0] ?? "판단할 수 없습니다."}</p>
          </div>
        </section>
      ))}

      <section className="section" id="analysis">
        <div className="section-heading">
          <p className="eyebrow">VIDEO ANALYSIS</p>
          <h2>영상 분석</h2>
          <p>MP4 · 최대 500 MB · 10분 이하</p>
        </div>

        <div
          className={`drop-zone${dragging ? " is-dragging" : ""}`}
          onDragOver={(event) => { event.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
        >
          <input ref={inputRef} className="sr-only" type="file" accept="video/mp4,.mp4" onChange={onFileChange} />
          <div className="upload-icon" aria-hidden="true">↑</div>
          <h3>파일 업로드</h3>
          <p>분석할 영상을 끌어 놓거나 선택하세요.</p>
          <button className="secondary-button" type="button" onClick={() => inputRef.current?.click()}>파일 선택</button>
        </div>

        {video && (
          <div className="selected-video">
            <div className="selected-video-info">
              <strong>{video.name}</strong>
              <span>{formatSize(video.size)}</span>
            </div>
            {previewUrl && <video className="preview" src={previewUrl} controls preload="metadata" />}
            <button className="primary-button" disabled={busy} onClick={() => void uploadAndQueue()}>
              {busy ? "업로드 중…" : "분석 요청"}
            </button>
          </div>
        )}

        <div className="history-block" id="history">
          <h3 className="subheading">작업 내역</h3>
          {videos.length === 0 ? (
            <p className="empty-state">아직 등록된 영상이 없습니다.</p>
          ) : (
            <div className="video-list">
              {videos.map((item) => {
                const analysis = latestAnalysis.get(item.id);
                return (
                  <article className="video-row" key={item.id}>
                    <div className="video-row-info">
                      <strong>{item.original_name}</strong>
                      <span>{formatSize(item.size_bytes)} · {new Date(item.created_at).toLocaleString("ko-KR")}</span>
                    </div>
                    <span className="status">{analysis ? statusLabel(analysis.status) : "업로드 완료"}</span>
                    <button className="text-button row-delete" type="button" onClick={() => void deleteVideo(item)}>삭제</button>
                    {analysis?.result_json?.events?.map((event, index) => (
                      <div className="analysis-event" key={event.eventId ?? `${item.id}-${index}`}>
                        <span>{formatTime(event.startMs)}–{formatTime(event.endMs)} · {event.techniqueId ?? "기술 판별 불가"} · {scoreLabel(event.score)} · 신뢰도 {event.confidenceBand}</span>
                        {event.eventId && !highlights.some((highlight) => highlight.event_id === event.eventId) && (
                          <button
                            className="secondary-button event-button"
                            type="button"
                            disabled={savingEventId === event.eventId}
                            onClick={() => void saveHighlight(item.id, event)}
                          >
                            {savingEventId === event.eventId ? "저장 중…" : "하이라이트 저장"}
                          </button>
                        )}
                      </div>
                    ))}
                  </article>
                );
              })}
            </div>
          )}
          <p className="disclaimer">분석 모델은 아직 연결되지 않았습니다. 점수 후보는 공식 판정이 아닙니다.</p>
        </div>
      </section>

      <section className="section" id="diary">
        <div className="section-heading">
          <p className="eyebrow">TRAINING DIARY</p>
          <h2>유도 일기</h2>
        </div>

        <label className="date-filter">
          날짜
          <input type="date" value={selectedDate} onChange={(event) => setSelectedDate(event.target.value)} />
        </label>
        <h3 className="subheading">{selectedDate} 의 하이라이트</h3>
        {dayHighlights.length === 0 ? (
          <p className="empty-state">선택한 날짜에 저장된 하이라이트가 없습니다.</p>
        ) : (
          <div className="highlight-list">
            {dayHighlights.map((item) => (
              <article className="highlight-item" key={item.id}>
                <strong>{item.title}</strong>
                <span>{formatTime(item.start_ms)}–{formatTime(item.end_ms)}</span>
              </article>
            ))}
          </div>
        )}

        <form className="form-panel" onSubmit={(event) => void saveDiary(event)}>
          <label>
            날짜
            <input type="date" value={entryDate} onChange={(event) => setEntryDate(event.target.value)} required />
          </label>
          <label>
            제목
            <input value={diaryTitle} onChange={(event) => setDiaryTitle(event.target.value)} maxLength={120} required />
          </label>
          <label>
            메모
            <textarea value={diaryNote} onChange={(event) => setDiaryNote(event.target.value)} maxLength={4000} rows={3} />
          </label>
          {highlights.length > 0 && (
            <fieldset>
              <legend>연결할 하이라이트</legend>
              {highlights.map((item) => (
                <label className="highlight-choice" key={item.id}>
                  <input
                    type="checkbox"
                    checked={selectedHighlightIds.includes(item.id)}
                    onChange={(event) => setSelectedHighlightIds((selected) =>
                      event.target.checked
                        ? [...selected, item.id]
                        : selected.filter((id) => id !== item.id),
                    )}
                  />
                  {item.title}
                </label>
              ))}
            </fieldset>
          )}
          <button className="primary-button" type="submit" disabled={busy || !diaryTitle.trim()}>
            {busy ? "저장 중…" : "일기 저장"}
          </button>
        </form>

        <div className="diary-list">
          {diaries.map((diary) => (
            <article className="diary-entry" key={diary.id}>
              {diary.thumbnailUrl && (
                <div
                  className="diary-thumb"
                  style={{ backgroundImage: `url("${diary.thumbnailUrl}")` }}
                  aria-hidden="true"
                />
              )}
              <span>{diary.entry_date}</span>
              <h3>{diary.title}</h3>
              {diary.note && <p>{diary.note}</p>}
            </article>
          ))}
        </div>
      </section>

      <section className="section" id="ranking">
        <div className="section-heading">
          <p className="eyebrow">JUDO RANKING</p>
          <h2>유도 랭킹</h2>
          <p>-score 기준 사용자 순위-</p>
        </div>
        <div className="ranking-layout">
          <table className="ranking-table">
            <thead>
              <tr><th scope="col">순위</th><th scope="col">아이디</th><th scope="col">score</th></tr>
            </thead>
            <tbody>
              <tr><td colSpan={3}>랭킹 데이터가 아직 없습니다.</td></tr>
            </tbody>
          </table>
          <aside className="rank-panel">
            <p className="eyebrow">MY RANK</p>
            <h3>나의 순위</h3>
            <p className="rank-value">—</p>
            <p className="rank-note">분석 결과가 쌓이면 순위가 표시됩니다.</p>
          </aside>
        </div>
      </section>

      <footer>
        <p>JUDO ANALYTICS</p>
        <span>AI 분석은 참고용이며 공식 심판 판정이 아닙니다.</span>
      </footer>
    </>
  );
}
