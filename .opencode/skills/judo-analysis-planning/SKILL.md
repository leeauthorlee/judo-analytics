---
name: Judo Video Analysis Planning
description: Plan or implement the judo-video analysis product; use first to keep the rules, evidence, model limits, and product scope explicit.
---

# Judo video analysis: project brief and non-negotiable assumptions

Use this skill before implementing or changing the end-to-end product. Read the other `judo-*` skills for the phase being worked on.

## Product target

The user supplies an MP4 recording of a judo bout. The system identifies likely techniques and estimates visible scoring outcomes (ippon/한판, waza-ari/절반, yuko/유효 when applicable, or no score/uncertain), with timestamps and supporting evidence. Treat this as **decision support**, not an official referee or an authoritative result. Make uncertainty and review status visible in the UI.

## Resolve these product questions before committing to a rule or data model

1. Which competition, age division, ruleset, and period are in scope? Judo scoring and penalties change. Store a rulebook/version identifier for each analysis and label; never mix rules silently.
2. Does “판정 결과” mean the score for each throw, the final contest result, penalties, or all of them? Final result may require the scoreboard, osaekomi timing, shido state, golden score, and referee calls—not just the throw image.
3. Which technique taxonomy and naming/language should be shown? Agree with a qualified judo referee/coach and map variants consistently.
4. What are the allowed video length, size, frame rates, camera angles, uploaders, retention period, and target latency/cost?
5. Who is allowed to access/delete videos, and can the project use the footage for model evaluation or training? Record ownership/licence, consent, source, and deletion obligations.

If a question changes the scoring definition, data schema, or architecture, ask the user instead of silently choosing.

## Important distinction: examples are not automatically a trained model

An archive of videos can serve as (a) an expert-labelled supervised dataset, (b) a retrieval/reference set, or (c) a test set. Simply attaching past videos to an LLM does not update its weights or guarantee a learned referee. OpenAI vision input accepts image inputs; the official Cookbook's video-understanding example extracts and samples frames and is explicitly archived. Before implementation, confirm the selected model/endpoint's current supported modalities and limits. A practical baseline is temporal frame/clip extraction plus model-assisted hypotheses, deterministic rule logic, and expert review. Do not claim fine-tuning or native MP4 understanding unless the selected API officially supports it.

## Suggested system shape

`Next.js UI (Vercel)` → authenticated direct upload to **private** object storage → database row/job → queue → FFmpeg/video worker → temporally sampled frames or model-compatible clips → vision/model inference → rule-aware aggregation and validation → persisted result/evidence → UI polling/status.

Do not decode a full match or run long video inference inside the request that uploads the file. Vercel documents a 4.5 MB Function request-body limit for server uploads and recommends client uploads for larger files. Vercel Functions also have execution limits; use a queue and durable worker/workflow for long work. A worker can run as a Vercel Daemon where plan/region/runtime support is appropriate, or as a separate container/GPU service. Verify current availability, quotas, pricing, and FFmpeg/GPU support before selecting.

## Recommended implementation order and deliverables

1. **Scope and rule policy** → written product brief: supported events/divisions, exact rulebook versions, meaning of “result,” uncertainty/manual-review policy, MP4 limits, privacy/retention, and acceptance thresholds. Get a referee/coach to approve scoring definitions.
2. **Data rights and labels** → provenance/permission manifest, annotation handbook, event schema, expert-labelled pilot set, disagreement review, and leakage-safe train/validation/test split. Do not start with prompt tuning on unlabeled videos.
3. **Offline technical prototype** → test FFprobe/FFmpeg, timestamp-safe event windows, candidate frame sampling, model modality and structured output on a small rights-cleared set; compare results with expert labels and measure cost/latency. Keep this separable from the website.
4. **MVP web/worker workflow** → Next.js upload/status/results UI, private Blob uploads, auth/database/job queue, retry-safe worker, result storage, deletion, and observable processing failures. First return candidate events with evidence and uncertainty, not a claimed official judgment.
5. **Evaluation and staged release** → frozen expert test set, class/subgroup/localization metrics, shadow run, agreed review thresholds, Vercel preview-to-production checks, monitoring, and rollback plan.

Each phase should meet its deliverable/acceptance criteria before the next one depends on it. The smallest useful first milestone is an offline prototype over a few referee-labelled clips, not a polished upload UI.

## Minimum result contract

Every result/event should carry:

- `startMs`, `endMs`, and evidence frame/clip timestamps;
- `techniqueId`/display name or `unknown`;
- `score`: `ippon | waza_ari | yuko | no_score | uncertain` (enable values only for the selected ruleset);
- `tori`/`uke` as anonymous bout-local roles, not real-world identity;
- evidence observations and limitations (e.g. landing hidden, only one camera view);
- confidence or calibrated decision band, model/version, ruleset version, and review state.

Do not let a language model invent frame timestamps, athlete identities, official calls, or evidence. Constrain output with a schema, then validate it in application code. A valid JSON shape is not proof that a sports judgment is correct.

## Official references (consult current versions at implementation time)

- OpenAI Images and vision: https://developers.openai.com/api/docs/guides/vision
- OpenAI Structured Outputs: https://developers.openai.com/api/docs/guides/structured-outputs
- OpenAI archived video-frames Cookbook recipe: https://developers.openai.com/cookbook/examples/gpt_with_vision_for_video_understanding
- OpenAI data controls/retention: https://developers.openai.com/api/docs/guides/your-data
- OpenAI API models: https://developers.openai.com/api/docs/models
- Next.js Route Handlers: https://nextjs.org/docs/app/api-reference/file-conventions/route
- Vercel Blob client uploads: https://vercel.com/docs/vercel-blob/client-upload
- Vercel background workers: https://vercel.com/docs/background-workers
- IJF rules portal: https://rules.ijf.org/
- IJF 2025 rule-change announcement: https://ijf.org/news/judo-presents-the-new-rules

The IJF articles are context, not a substitute for the exact rulebook governing a specific bout. Check the applicable event rules and amendments with a qualified domain expert.

## Completion criteria for any phase

- User-visible claims match what the system actually measured; uncertainty is not hidden.
- Rule/data/model versions are traceable and results are reproducible from persisted inputs/metadata.
- Video, frame, and model API secrets are not exposed to the browser or public URLs.
- Tests include unusable footage, ambiguous events, network/model failures, and the relevant rule versions.
- A human-review path exists for low-confidence or disputed outcomes.
