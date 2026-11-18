"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";

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
};

function formatTime(ms: number) {
  const seconds = Math.floor(ms / 1000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

export default function RecordsClient({
  highlights,
  diaries,
}: {
  highlights: Highlight[];
  diaries: Diary[];
}) {
  const router = useRouter();
  const [selectedDate, setSelectedDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [entryDate, setEntryDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [title, setTitle] = useState("");
  const [note, setNote] = useState("");
  const [selectedHighlightIds, setSelectedHighlightIds] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const dayHighlights = highlights.filter((item) => item.created_at.slice(0, 10) === selectedDate);

  async function saveDiary(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const response = await fetch("/api/diaries", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ entryDate, title, note, highlightIds: selectedHighlightIds }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "일기를 저장하지 못했습니다.");
      setTitle("");
      setNote("");
      setSelectedHighlightIds([]);
      setMessage("일기를 저장했습니다.");
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "일기 저장에 실패했습니다.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <section className="section" id="highlights">
        <div className="section-heading">
          <p className="eyebrow">MY RECORDS</p>
          <h2>나의 기록</h2>
          <p>날짜를 선택해 하이라이트를 확인하세요.</p>
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
      </section>

      <section className="section" id="diary">
        <div className="section-heading">
          <p className="eyebrow">TRAINING DIARY</p>
          <h2>유도 일기</h2>
        </div>

        <form className="form-panel" onSubmit={(event) => void saveDiary(event)}>
          <label>
            날짜
            <input type="date" value={entryDate} onChange={(event) => setEntryDate(event.target.value)} required />
          </label>
          <label>
            제목
            <input value={title} onChange={(event) => setTitle(event.target.value)} maxLength={120} required />
          </label>
          <label>
            메모
            <textarea value={note} onChange={(event) => setNote(event.target.value)} maxLength={4000} rows={3} />
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
          <button className="primary-button" type="submit" disabled={busy || !title.trim()}>
            {busy ? "저장 중…" : "일기 저장"}
          </button>
        </form>

        {error && <p className="feedback error" role="alert">{error}</p>}
        {message && <p className="feedback notice" role="status">{message}</p>}

        <div className="diary-list">
          {diaries.map((diary) => (
            <article className="diary-entry" key={diary.id}>
              <span>{diary.entry_date}</span>
              <h3>{diary.title}</h3>
              {diary.note && <p>{diary.note}</p>}
            </article>
          ))}
        </div>
      </section>
    </>
  );
}
