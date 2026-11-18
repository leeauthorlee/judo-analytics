import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { analyzeVideo, mapPrediction, validateInterval, MODEL_VERSION } from "./analysis-provider.js";

function prediction() {
  return { model_version: MODEL_VERSION, status: "requires_user_review", service_score: "unreviewed",
    interval: { start: 2, end: 4 }, candidates: [
      { technique: "uchi_mata", model_score: 0.6 }, { technique: "osoto_gari", model_score: 0.2 },
      { technique: "o_goshi", model_score: 0.15 }] };
}
test("selection rejects invalid, out of bounds and >30s intervals", () => {
  validateInterval(0, 30000, 30000);
  for (const args of [[0,30001,60000],[-1,1000,60000],[0,60001,60000],[1,1,10],[NaN,1,10],[0,0.5,10],[0,1,NaN]]) {
    assert.throws(() => validateInterval(...args));
  }
});
test("adapter preserves candidates without inventing a score or roles", () => {
  const result = mapPrediction(prediction(), 2000, 4000);
  assert.equal(result.events[0].techniqueCandidates.length, 3);
  assert.equal(result.events[0].techniqueId, "uchi_mata");
  assert.equal(result.events[0].serviceScore, "unreviewed");
  assert.equal(result.events[0].score, "uncertain");
  assert.equal(result.events[0].toriRole, "unknown");
});
test("malformed and incompatible model responses are rejected", () => {
  for (const change of [p => p.model_version = "wrong", p => p.service_score = "ippon",
    p => p.interval.end = 10, p => p.candidates[0].model_score = NaN,
    p => p.candidates[0].technique = "unsupported", p => p.candidates[1].technique = "uchi_mata"]) {
    const p = prediction(); change(p); assert.throws(() => mapPrediction(p, 2000, 4000));
  }
});
test("real Python checkpoint returns a validated worker result", { skip: process.env.RUN_MODEL_TEST !== "1", timeout: 150000 }, async () => {
  const manifest = JSON.parse(await readFile(new URL("../analysis-model/data/manifest.json", import.meta.url), "utf8"));
  const sample = manifest.find(r => r.split === "test");
  const filePath = fileURLToPath(new URL(`../analysis-model/${sample.path}`, import.meta.url));
  const result = await analyzeVideo({ filePath, startMs: 0, endMs: 1000, durationMs: Math.round(sample.duration * 1000) });
  assert.equal(result.providerVersion, MODEL_VERSION);
  assert.equal(result.events[0].serviceScore, "unreviewed");
  assert.equal(result.events[0].endMs, 1000);
});
