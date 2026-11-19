/** The worker auto-creates a placeholder diary when analysis completes. */
export const PENDING_DIARY_PREFIX = "AI 기술 후보:";

export function isPendingDiary(note: string | null | undefined) {
  return typeof note === "string" && note.startsWith(PENDING_DIARY_PREFIX);
}

export const MAX_DIARY_CONTENT = 200;
