"use client";

import { useEffect, useRef, useState, type ChangeEvent, type DragEvent } from "react";
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
};

type Analysis = {
  id: string;
  video_id: string;
  status: "queued" | "processing" | "review_required" | "completed" | "failed";
  error_code: string | null;
  created_at: string;
  result_json: { events?: AnalysisEvent[] } | null;
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

export default function AnalysisClient({
  userId,
  videos,
  analyses,
}: {
  userId: string;
  videos: Video[];
  analyses: Analysis[];
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
      await upload(pathname, video, {
        access: "private",
        handleUploadUrl: "/api/uploads",
        contentType: "video/mp4",
        multipart: true,
      });

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
        body: JSON.stringify({ videoId: videoBody.video.id }),
      });
      const analysisBody = await analysisResponse.json();
      if (!analysisResponse.ok) throw new Error(analysisBody.error ?? "분석 작업을 등록하지 못했습니다.");

      setMessage(
        analysisBody.analysis.dispatchStatus === "worker_not_configured"
          ? "영상이 저장되었고 분석 작업도 등록했습니다. 워커 연결 후 처리됩니다."
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

  return (
    <>
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
        {error && <p className="feedback error" role="alert">{error}</p>}
        {message && <p className="feedback notice" role="status">{message}</p>}
      </section>

      <section className="section" id="history">
        <div className="section-heading">
          <p className="eyebrow">YOUR WORKSPACE</p>
          <h2>최근 영상</h2>
        </div>
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
                    </div>
                  ))}
                </article>
              );
            })}
          </div>
        )}
        <p className="disclaimer">분석 모델은 아직 연결되지 않았습니다. 점수 후보는 공식 판정이 아닙니다.</p>
      </section>
    </>
  );
}
