export type JudoScore =
  | "ippon"
  | "waza_ari"
  | "yuko"
  | "no_score"
  | "uncertain";

export type JudoAnalysisEvent = {
  startMs: number;
  endMs: number;
  techniqueId: string | null;
  eventId?: string;
  techniqueCandidates?: { techniqueId: string; nameKo: string; modelScore: number }[];
  serviceScore?: "unreviewed";
  score: JudoScore;
  toriRole: "blue" | "white" | "unknown";
  ukeRole: "blue" | "white" | "unknown";
  observations: string[];
  missingEvidence: string[];
  confidenceBand: "low" | "medium" | "high";
};

export type JudoAnalysisResult = {
  provider: string;
  providerVersion: string;
  rulesetId: string;
  events: JudoAnalysisEvent[];
  disclaimer: string;
};

export type StoredVideoReference = {
  pathname: string;
  contentType: "video/mp4";
  sizeBytes: number;
  originalName: string;
};

export interface JudoAnalysisProvider {
  readonly id: string;
  analyze(video: StoredVideoReference): Promise<JudoAnalysisResult>;
}
