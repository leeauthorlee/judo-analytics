import type { JudoAnalysisProvider } from "@/lib/analysis/types";

/**
 * Inference runs in worker/analysis-provider.js, never inside a Vercel request.
 * This legacy in-process provider is intentionally unavailable.
 */
export function getJudoAnalysisProvider(): JudoAnalysisProvider | null {
  return null;
}
