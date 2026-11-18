import { createServer } from "node:http";
import { createWriteStream } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { pipeline } from "node:stream/promises";
import { execFile as execFileCallback } from "node:child_process";
import { promisify } from "node:util";
import { createClient } from "@supabase/supabase-js";
import { analyzeVideo, isModelConfigured, ModelNotConfiguredError, InvalidAnalysisIntervalError } from "./analysis-provider.js";

const execFile = promisify(execFileCallback);
const supabase = createClient(requiredEnv("SUPABASE_URL"), requiredEnv("SUPABASE_SERVICE_ROLE_KEY"),
  { auth: { autoRefreshToken: false, persistSession: false } });

function requiredEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}
class VideoValidationError extends Error {
  constructor(code) { super(code); this.code = code; }
}
async function setFailed(id, attempt, code) {
  const { error } = await supabase.from("video_analyses").update({ status: "failed", error_code: code, completed_at: new Date().toISOString() })
    .eq("id", id).eq("attempts", attempt).eq("status", "processing");
  if (error) throw error;
}
async function inspectVideo(filePath) {
  let metadata;
  try {
    const { stdout } = await execFile("ffprobe", ["-v", "error", "-show_entries",
      "format=format_name,duration:stream=codec_type,codec_name,width,height,avg_frame_rate", "-of", "json", filePath],
    { maxBuffer: 1024 * 1024, timeout: 30_000, windowsHide: true });
    metadata = JSON.parse(stdout);
  } catch { throw new VideoValidationError("INVALID_VIDEO"); }
  const formats = String(metadata.format?.format_name ?? "").split(",");
  const stream = metadata.streams?.find((s) => s.codec_type === "video");
  const durationMs = Math.round(Number(metadata.format?.duration) * 1000);
  if (!formats.includes("mp4") || !stream || !Number.isSafeInteger(durationMs) || durationMs <= 0) throw new VideoValidationError("INVALID_VIDEO");
  if (durationMs > 600_000) throw new VideoValidationError("VIDEO_TOO_LONG");
  const [numerator, denominator] = String(stream.avg_frame_rate).split("/").map(Number);
  const rate = numerator / denominator;
  return { duration_ms: durationMs, width: Number.isInteger(stream.width) ? stream.width : null,
    height: Number.isInteger(stream.height) ? stream.height : null,
    frame_rate: Number.isFinite(rate) && rate > 0 ? rate : null,
    video_codec: typeof stream.codec_name === "string" ? stream.codec_name : null, container: formats.join(",") };
}

async function handleTask(request, response) {
  let body = "";
  for await (const chunk of request) {
    body += chunk;
    if (body.length > 32_768) { response.writeHead(413).end(); return; }
  }
  let id;
  try {
    id = JSON.parse(body).analysis_id;
    if (typeof id !== "string" || !/^[0-9a-f-]{36}$/i.test(id)) throw new Error();
  } catch { response.writeHead(400).end("Invalid task payload"); return; }
  const { data: analysis, error } = await supabase.from("video_analyses")
    .select("id,video_id,status,attempts,input_json,video_assets!inner(storage_key,deleted_at)").eq("id", id).maybeSingle();
  if (error || !analysis) { response.writeHead(404).end("Analysis not found"); return; }
  if (["completed", "review_required"].includes(analysis.status)) { response.writeHead(200).end("Already completed"); return; }
  const attempt = analysis.attempts + 1;
  const leaseExpired = new Date(Date.now() - 15 * 60 * 1000).toISOString();
  const { data: claimed, error: claimError } = await supabase.from("video_analyses").update({
    status: "processing", error_code: null, result_json: null, attempts: attempt, started_at: new Date().toISOString(),
  }).eq("id", id).eq("attempts", analysis.attempts)
    .or(`status.in.(queued,failed),and(status.eq.processing,started_at.lt.${leaseExpired})`).select("id").maybeSingle();
  if (claimError || !claimed) { response.writeHead(503).end("Analysis running or claim failed"); return; }

  let directory;
  try {
    const video = Array.isArray(analysis.video_assets) ? analysis.video_assets[0] : analysis.video_assets;
    if (video.deleted_at) throw new VideoValidationError("VIDEO_NOT_FOUND");
    if (!isModelConfigured()) throw new ModelNotConfiguredError();
    const signed = await fetch(`${requiredEnv("WEB_APP_URL").replace(/\/$/, "")}/api/worker/blob-url`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-worker-secret": requiredEnv("WORKER_API_SECRET") },
      body: JSON.stringify({ pathname: video.storage_key }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!signed.ok) throw new VideoValidationError("VIDEO_NOT_FOUND");
    const { url } = await signed.json();
    if (typeof url !== "string") throw new VideoValidationError("VIDEO_NOT_FOUND");
    const blobResponse = await fetch(url, { signal: AbortSignal.timeout(120_000) });
    if (!blobResponse.ok || !blobResponse.body) throw new VideoValidationError("VIDEO_NOT_FOUND");
    directory = await mkdtemp(join(tmpdir(), "judo-analysis-"));
    const filePath = join(directory, "source.mp4");
    await pipeline(blobResponse.body, createWriteStream(filePath));
    const media = await inspectVideo(filePath);
    const { error: mediaError } = await supabase.from("video_assets").update({ ...media, status: "ready" }).eq("id", analysis.video_id);
    if (mediaError) throw mediaError;
    const result = await analyzeVideo({ filePath, startMs: analysis.input_json?.startMs,
      endMs: analysis.input_json?.endMs, durationMs: media.duration_ms });
    const { error: resultError } = await supabase.rpc("complete_judo_analysis", { target_id: id, expected_attempt: attempt, model_result: result });
    if (resultError) throw resultError;
    response.writeHead(200).end("Analysis completed; user review required");
  } catch (cause) {
    const code = cause instanceof VideoValidationError ? cause.code
      : cause instanceof ModelNotConfiguredError ? "MODEL_NOT_CONFIGURED"
        : cause instanceof InvalidAnalysisIntervalError ? "INVALID_ANALYSIS_INTERVAL" : "WORKER_FAILED";
    await setFailed(id, attempt, code);
    console.error("ANALYSIS_FAILED", id, code);
    response.writeHead(code === "WORKER_FAILED" ? 500 : 200).end("Analysis failed");
  } finally {
    // Check the exact temporary target before recursive removal on Windows too.
    if (directory && resolve(directory).startsWith(resolve(tmpdir()) + sep) &&
        resolve(directory).split(sep).at(-1).startsWith("judo-analysis-")) {
      await rm(directory, { recursive: true, force: true });
    }
  }
}

const server = createServer((request, response) => {
  if (request.method === "GET" && request.url === "/health") {
    response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ ok: true, modelConfigured: isModelConfigured() }));
    return;
  }
  // Cloud Run must require IAM authentication; Cloud Tasks supplies the OIDC token.
  if (request.method === "POST" && request.url === "/tasks") {
    void handleTask(request, response).catch(() => { if (!response.headersSent) response.writeHead(500).end("Worker error"); });
    return;
  }
  response.writeHead(404).end();
});
server.listen(Number(process.env.PORT ?? 8080), "0.0.0.0");
