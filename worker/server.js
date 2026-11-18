import { createServer } from "node:http";
import { createWriteStream } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pipeline } from "node:stream/promises";
import { execFile as execFileCallback } from "node:child_process";
import { promisify } from "node:util";
import { createClient } from "@supabase/supabase-js";
import { get } from "@vercel/blob";
import { analyzeVideo, isModelConfigured, ModelNotConfiguredError } from "./analysis-provider.js";

const execFile = promisify(execFileCallback);
const MAX_DURATION_MS = 10 * 60 * 1000;
const supabase = createClient(
  requiredEnv("SUPABASE_URL"),
  requiredEnv("SUPABASE_SERVICE_ROLE_KEY"),
  { auth: { autoRefreshToken: false, persistSession: false } },
);

function requiredEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

async function setFailed(analysisId, errorCode) {
  await supabase.from("video_analyses").update({ status: "failed", error_code: errorCode, completed_at: new Date().toISOString() }).eq("id", analysisId);
}

class VideoValidationError extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}

function parseFrameRate(value) {
  if (typeof value !== "string") return null;
  const [numerator, denominator] = value.split("/").map(Number);
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator === 0) return null;
  const frameRate = numerator / denominator;
  return Number.isFinite(frameRate) && frameRate > 0 ? frameRate : null;
}

async function inspectVideo(filePath) {
  let output;
  try {
    ({ stdout: output } = await execFile("ffprobe", [
      "-v", "error",
      "-show_entries", "format=format_name,duration:stream=codec_type,codec_name,width,height,avg_frame_rate",
      "-of", "json", filePath,
    ], { maxBuffer: 1024 * 1024 }));
  } catch {
    throw new VideoValidationError("INVALID_VIDEO");
  }
  const metadata = JSON.parse(output);
  const formatNames = String(metadata.format?.format_name ?? "").split(",");
  const videoStream = metadata.streams?.find((stream) => stream.codec_type === "video");
  const durationMs = Math.round(Number(metadata.format?.duration) * 1000);
  if (!formatNames.includes("mp4") || !videoStream || !Number.isSafeInteger(durationMs) || durationMs <= 0) {
    throw new VideoValidationError("INVALID_VIDEO");
  }
  if (durationMs > MAX_DURATION_MS) throw new VideoValidationError("VIDEO_TOO_LONG");
  return {
    duration_ms: durationMs,
    width: Number.isInteger(videoStream.width) ? videoStream.width : null,
    height: Number.isInteger(videoStream.height) ? videoStream.height : null,
    frame_rate: parseFrameRate(videoStream.avg_frame_rate),
    video_codec: typeof videoStream.codec_name === "string" ? videoStream.codec_name : null,
    container: formatNames.join(","),
  };
}

async function storeResult(analysisId, rulesetId, result) {
  const savedEvents = [];
  for (const event of result.events) {
    const { data: technique } = event.techniqueId
      ? await supabase.from("techniques").select("id").eq("id", event.techniqueId).maybeSingle()
      : { data: null };
    const { data: savedEvent, error: eventError } = await supabase
      .from("analysis_events")
      .insert({
        analysis_id: analysisId,
        technique_id: technique?.id ?? null,
        tori_role: event.toriRole,
        uke_role: event.ukeRole,
        start_ms: event.startMs,
        end_ms: event.endMs,
        observations: event.observations,
        missing_evidence: event.missingEvidence,
      })
      .select("id")
      .single();
    if (eventError) throw eventError;
    savedEvents.push({ ...event, eventId: savedEvent.id });

    const { error: assessmentError } = await supabase.from("event_assessments").insert({
      event_id: savedEvent.id,
      ruleset_id: rulesetId,
      assessment_source: "model",
      score_label: event.score,
      confidence_band: event.confidenceBand,
      evidence_json: { observations: event.observations, missingEvidence: event.missingEvidence },
      review_status: "pending",
    });
    if (assessmentError) throw assessmentError;
  }
  return savedEvents;
}

async function handleTask(request, response) {
  let body = "";
  for await (const chunk of request) {
    body += chunk;
    if (body.length > 32_768) {
      response.writeHead(413).end();
      return;
    }
  }

  let analysisId;
  try {
    analysisId = JSON.parse(body).analysis_id;
    if (typeof analysisId !== "string" || !/^[0-9a-f-]{36}$/i.test(analysisId)) throw new Error();
  } catch {
    response.writeHead(400).end("Invalid task payload");
    return;
  }

  const { data: analysis, error: loadError } = await supabase
    .from("video_analyses")
    .select("id,video_id,ruleset_id,status,attempts,video_assets!inner(storage_key,original_name,size_bytes)")
    .eq("id", analysisId)
    .maybeSingle();
  if (loadError || !analysis) {
    response.writeHead(404).end("Analysis not found");
    return;
  }
  if (["completed", "review_required"].includes(analysis.status)) {
    response.writeHead(200).end("Already completed");
    return;
  }

  await supabase.from("video_analyses").update({
    status: "processing",
    error_code: null,
    result_json: null,
    attempts: (analysis.attempts ?? 0) + 1,
    started_at: new Date().toISOString(),
  }).eq("id", analysisId);
  await supabase.from("analysis_events").delete().eq("analysis_id", analysisId);

  let tempDirectory;
  try {
    const video = Array.isArray(analysis.video_assets) ? analysis.video_assets[0] : analysis.video_assets;
    const blob = await get(video.storage_key, { access: "private", token: requiredEnv("BLOB_READ_WRITE_TOKEN") });
    if (!blob?.stream) throw new VideoValidationError("VIDEO_NOT_FOUND");

    tempDirectory = await mkdtemp(join(tmpdir(), "judo-analysis-"));
    const filePath = join(tempDirectory, "source.mp4");
    await pipeline(blob.stream, createWriteStream(filePath));
    const media = await inspectVideo(filePath);
    const { error: mediaError } = await supabase.from("video_assets").update({ ...media, status: "ready" }).eq("id", analysis.video_id);
    if (mediaError) throw mediaError;

    if (!isModelConfigured()) {
      const temporaryResult = {
        provider: "unavailable",
        providerVersion: "offline",
        rulesetId: "ruleset_unknown",
        disclaimer: "분석 모델이 연결되지 않아 판단 불가로 표시합니다. 공식 판정이 아닙니다.",
        events: [{
          startMs: 0,
          endMs: 1000,
          techniqueId: null,
          score: "uncertain",
          toriRole: "unknown",
          ukeRole: "unknown",
          observations: ["분석 모델이 연결되지 않아 기술과 점수를 판단할 수 없습니다."],
          missingEvidence: ["모델 추론 결과", "관절 시계열"],
          confidenceBand: "low",
        }],
      };
      await storeResult(analysisId, analysis.ruleset_id, temporaryResult);
      await supabase.from("video_analyses").update({
        status: "review_required",
        result_json: temporaryResult,
        completed_at: new Date().toISOString(),
      }).eq("id", analysisId);
      response.writeHead(200).end("Temporary result stored");
      return;
    }

    const result = await analyzeVideo({ filePath, video, rulesetId: analysis.ruleset_id });
    const events = await storeResult(analysisId, analysis.ruleset_id, result);
    const reviewRequired = result.events.some((event) => event.score === "uncertain" || event.confidenceBand === "low");
    await supabase.from("video_analyses").update({
      status: reviewRequired ? "review_required" : "completed",
      result_json: { ...result, events },
      completed_at: new Date().toISOString(),
    }).eq("id", analysisId);
    response.writeHead(200).end("Analysis completed");
  } catch (error) {
    const permanentCode = error instanceof VideoValidationError
      ? error.code
      : error instanceof ModelNotConfiguredError ? "MODEL_NOT_CONFIGURED" : null;
    await setFailed(analysisId, permanentCode ?? "WORKER_FAILED");
    if (error instanceof VideoValidationError) {
      const { data: analysis } = await supabase.from("video_analyses").select("video_id").eq("id", analysisId).maybeSingle();
      if (analysis) await supabase.from("video_assets").update({ status: "failed" }).eq("id", analysis.video_id);
    }
    response.writeHead(permanentCode ? 200 : 500).end("Analysis failed");
  } finally {
    if (tempDirectory) await rm(tempDirectory, { recursive: true, force: true });
  }
}

const server = createServer((request, response) => {
  if (request.method === "GET" && request.url === "/health") {
    response.writeHead(200, { "content-type": "application/json" }).end('{"ok":true}');
    return;
  }
  if (request.method === "POST" && request.url === "/tasks") {
    void handleTask(request, response).catch(() => response.writeHead(500).end("Worker error"));
    return;
  }
  response.writeHead(404).end();
});

server.listen(Number(process.env.PORT ?? 8080), "0.0.0.0");
