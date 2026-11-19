"use client";

import { useState, type FormEvent } from "react";
import { MAX_DIARY_CONTENT } from "@/lib/diary";

export default function DiaryModal({
  technique,
  analysisId,
  onClose,
  onSaved,
}: {
  technique: string;
  analysisId: string;
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const [content, setContent] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (content.length > MAX_DIARY_CONTENT) {
      setError(`일기 내용은 ${MAX_DIARY_CONTENT}자 이하여야 합니다.`);
      return;
    }
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/diaries", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ analysisId, content }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "일기를 저장하지 못했습니다.");
      onSaved(`일기를 저장했습니다. 랭킹 ${result.points ?? 0}점이 적립되었습니다.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "일기 저장에 실패했습니다.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="modal-backdrop" role="presentation" onClick={() => { if (!busy) onClose(); }}>
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="diary-modal-title" onClick={(e) => e.stopPropagation()}>
        <h3 id="diary-modal-title">일기에 등록하기</h3>
        <form onSubmit={(e) => void save(e)}>
          <label>
            관련 기술명
            <input value={technique} readOnly aria-readonly="true" />
          </label>
          <label>
            일기 내용
            <textarea
              value={content}
              onChange={(event) => setContent(event.target.value)}
              maxLength={MAX_DIARY_CONTENT}
              rows={5}
              placeholder="오늘 연습에서 느낀 점을 적어 보세요."
            />
          </label>
          <span className="char-count">{content.length} / {MAX_DIARY_CONTENT}</span>
          {error && <p className="feedback error" role="alert">{error}</p>}
          <div className="modal-actions">
            <button className="primary-button" type="submit" disabled={busy || content.length > MAX_DIARY_CONTENT}>
              {busy ? "저장 중…" : "저장"}
            </button>
            <button className="secondary-button" type="button" disabled={busy} onClick={onClose}>취소</button>
          </div>
        </form>
      </div>
    </div>
  );
}
