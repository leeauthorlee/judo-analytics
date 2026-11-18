import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execute = promisify(execFile);
const modelDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "../analysis-model");
export const MODEL_VERSION = "frozen_r3d18_kinetics400_linear_v1";
export const TECHNIQUES = {
  ippon_seoi_nage: "한팔업어치기", o_goshi: "허리껴치기",
  osoto_gari: "밭다리후리기", uchi_mata: "허벅다리걸기",
};

export class ModelNotConfiguredError extends Error {
  constructor() {
    super("The trained model or Python inference entry point is missing.");
    this.name = "ModelNotConfiguredError";
  }
}
export class InvalidAnalysisIntervalError extends Error {}

export function isModelConfigured() {
  return existsSync(join(modelDirectory, "models/judo_r3d18.pt")) && existsSync(join(modelDirectory, "predict.py"));
}
export function validateInterval(startMs, endMs, durationMs) {
  if (!Number.isSafeInteger(durationMs) || durationMs <= 0 || !Number.isSafeInteger(startMs) || !Number.isSafeInteger(endMs) || startMs < 0 ||
      endMs <= startMs || endMs - startMs > 30_000 || endMs > durationMs) {
    throw new InvalidAnalysisIntervalError("Select a valid attack interval of at most 30 seconds.");
  }
}
export function mapPrediction(prediction, startMs, endMs) {
  if (prediction.model_version !== MODEL_VERSION || prediction.status !== "requires_user_review" ||
      prediction.service_score !== "unreviewed" || !Array.isArray(prediction.candidates) ||
      prediction.candidates.length !== 3 ||
      !Number.isFinite(prediction.interval?.start) || !Number.isFinite(prediction.interval?.end) ||
      Math.abs(prediction.interval.start * 1000 - startMs) > 1 ||
      Math.abs(prediction.interval.end * 1000 - endMs) > 1) throw new Error("Invalid model response");
  const seen = new Set();
  let previousScore = 1;
  const candidates = prediction.candidates.map((candidate) => {
    if (!Object.hasOwn(TECHNIQUES, candidate.technique) || seen.has(candidate.technique) ||
        !Number.isFinite(candidate.model_score) || candidate.model_score < 0 ||
        candidate.model_score > previousScore) throw new Error("Invalid technique candidates");
    seen.add(candidate.technique);
    previousScore = candidate.model_score;
    return { techniqueId: candidate.technique, nameKo: TECHNIQUES[candidate.technique], modelScore: candidate.model_score };
  });
  return {
    provider: "local-r3d18", providerVersion: MODEL_VERSION, rulesetId: "service_landing_v1",
    disclaimer: "4종 기술을 추천하는 실험 모델입니다. 기술과 착지를 직접 확인하세요. 공식 심판 판정이 아닙니다.",
    events: [{
      startMs, endMs, techniqueId: candidates[0].techniqueId, techniqueCandidates: candidates,
      score: "uncertain", serviceScore: "unreviewed", toriRole: "unknown", ukeRole: "unknown", confidenceBand: "low",
      observations: [`선택한 공격 구간의 1순위 후보: ${candidates[0].nameKo}`, "후보 순서는 보정되지 않은 모델 점수 기준입니다."],
      missingEvidence: ["착지는 사용자가 확인해야 합니다.", "공격자·착지 선수는 자동 식별하지 않습니다."],
    }],
  };
}
export async function analyzeVideo({ filePath, startMs, endMs, durationMs }) {
  validateInterval(startMs, endMs, durationMs);
  if (!isModelConfigured()) throw new ModelNotConfiguredError();
  const localPython = join(modelDirectory, ".venv", process.platform === "win32" ? "Scripts/python.exe" : "bin/python");
  const python = process.env.JUDO_PYTHON_PATH || (existsSync(localPython) ? localPython : "python3");
  const { stdout } = await execute(python, [join(modelDirectory, "predict.py"), filePath,
    "--start", String(startMs / 1000), "--end", String(endMs / 1000), "--stdout"], {
    timeout: 120_000, maxBuffer: 1024 * 1024, windowsHide: true,
    env: { ...process.env, PYTHONUTF8: "1" },
  });
  return mapPrediction(JSON.parse(stdout), startMs, endMs);
}
