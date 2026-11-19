/**
 * Single source of truth for ranking points.
 *
 * The model's uncalibrated candidate scores are NOT ranking points. This value
 * is only granted once a diary entry is registered for a confirmed technique.
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

/** Points granted for a diary entry. Unsupported/unknown techniques earn nothing. */
export function pointsForTechnique(id: unknown): number {
  return isSupportedTechnique(id) ? POINTS_PER_DIARY : 0;
}

export function maskDisplayName(value: string | null | undefined): string {
  if (!value || value.length < 4) return "****";
  return `${value.slice(0, 4)}****`;
}
