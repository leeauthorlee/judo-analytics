/**
 * Single source of truth for ranking points.
 *
 * The AI produces one final technique and a confidence value. Points are
 * derived from that AI result on the server (never from a client value) and
 * are credited only when the diary entry is registered.
 */
export const POINTS_PER_DIARY = 3;

export const SUPPORTED_TECHNIQUES = {
  ippon_seoi_nage: "한팔업어치기",
  o_goshi: "허리껴치기",
  osoto_gari: "밭다리후리기",
  uchi_mata: "허벅다리걸기",
} as const;

export type SupportedTechniqueId = keyof typeof SUPPORTED_TECHNIQUES;

export const UNSUPPORTED_TECHNIQUES = ["unsupported", "unknown"] as const;

export function isSupportedTechnique(value: unknown): value is SupportedTechniqueId {
  return typeof value === "string" && Object.hasOwn(SUPPORTED_TECHNIQUES, value);
}

export function techniqueName(id: unknown): string | null {
  return isSupportedTechnique(id) ? SUPPORTED_TECHNIQUES[id] : null;
}

export type AiResultLike = {
  events?: Array<{
    techniqueId?: string | null;
    techniqueCandidates?: Array<{ techniqueId?: string; modelScore?: number }> | null;
  }> | null;
} | null | undefined;

/** The AI's single final technique (top candidate), not a list of three. */
export function aiTechniqueId(result: AiResultLike): string | null {
  const event = result?.events?.[0];
  if (!event) return null;
  if (isSupportedTechnique(event.techniqueId)) return event.techniqueId;
  const top = event.techniqueCandidates?.[0]?.techniqueId;
  return isSupportedTechnique(top) ? top : null;
}

export function aiConfidence(result: AiResultLike): number {
  const score = result?.events?.[0]?.techniqueCandidates?.[0]?.modelScore;
  return typeof score === "number" && Number.isFinite(score) ? Math.min(1, Math.max(0, score)) : 0;
}

/**
 * AI-result-based points. Supported technique + higher confidence earns more.
 * Unsupported / undetermined results earn zero and are never silently replaced.
 */
export function aiPointsFromResult(result: AiResultLike): number {
  if (!aiTechniqueId(result)) return 0;
  const confidence = aiConfidence(result);
  if (confidence >= 0.7) return POINTS_PER_DIARY;
  if (confidence >= 0.4) return 2;
  return 1;
}

/** Fallback for manually written diaries that have no AI analysis attached. */
export function pointsForTechnique(id: unknown): number {
  return isSupportedTechnique(id) ? POINTS_PER_DIARY : 0;
}

export function maskDisplayName(value: string | null | undefined): string {
  if (!value || value.length < 4) return "****";
  return `${value.slice(0, 4)}****`;
}
