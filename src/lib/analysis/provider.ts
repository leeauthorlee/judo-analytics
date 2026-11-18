import type { JudoAnalysisProvider } from "@/lib/analysis/types";

/**
 * Register a reviewed, trained model adapter here when it is ready.
 * Training/data ingestion is deliberately not implemented in this project yet.
 */
export function getJudoAnalysisProvider(): JudoAnalysisProvider | null {
  return null;
}
