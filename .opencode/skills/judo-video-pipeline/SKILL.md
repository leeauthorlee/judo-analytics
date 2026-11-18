---
name: Judo Video Inference Pipeline
description: Implement video ingestion, temporal sampling, OpenAI vision inference, structured outputs, and cautious rule-aware result aggregation.
---

# Video inference and model integration

Use for video processing, OpenAI API/model integration, event detection, response schemas, and result aggregation.

## 1. Verify the provider contract before coding

Read the current model page and API docs for the chosen model/endpoint. Confirm input modalities, supported image formats, image count/payload limits, detail options, structured-output compatibility, rate limits, pricing, retention, and whether video/audio is supported natively. Do not infer support from ChatGPT product features or SDK types.

OpenAI's current vision guide documents image URL, base64, and file-ID inputs. The official Cookbook's video recipe shows sampling video frames and sending them as images and is marked archived; use it as a conceptual frame-extraction reference only, not as a current model/limit guarantee. Unless official current docs confirm native MP4 input for the selected API/model, use a local video-processing stage to create image/clip inputs.

## 2. Pipeline architecture

1. Accept an uploaded object reference and metadata, not an unbounded in-memory video body.
2. Validate ownership, file size/duration, MIME **and** file signature/container, and reject malformed/unsupported uploads. Use generated object names; do not trust client filenames.
3. Inspect codec, duration, dimensions, rotation, frame rate, and time base with FFprobe.
4. Use FFmpeg to create a low-resolution overview/contact sheet or sampled frames; then refine candidate moments with denser temporal samples. Preserve source timestamps and account for variable frame rate/rotation.
5. Detect candidate event windows. Avoid uniform sparse sampling alone for fast throws: it can miss the attack and landing. Consider optical-flow/pose/action models or a first-pass coarse scan followed by a dense scan around transitions.
6. Send only bounded, relevant, ordered frames/clips to the selected model. Include timestamps in prompt text/metadata and label them from trusted preprocessing—not generated output.
7. Ask the model for observations/hypotheses and a constrained schema. Make it return `uncertain` if evidence is hidden or incomplete. Keep it from filling missing information using sports priors.
8. Apply a deterministic, versioned rules layer where rules can be encoded; preserve distinctions between visual estimate, official signal, and final bout result.
9. Persist raw request/response references only under an explicit retention policy, plus compact normalized event records, model/prompt/ruleset versions, costs, and failure state.
10. Provide retry-safe, idempotent jobs and a manual-review state. Make repeated queue deliveries safe.

## 3. Output contract and safeguards

Use OpenAI Structured Outputs when available for the selected model. Define enums such as:

```ts
type Score = 'ippon' | 'waza_ari' | 'yuko' | 'no_score' | 'uncertain';
type EventResult = {
  startMs: number;
  endMs: number;
  techniqueId: string | null;
  score: Score;
  toriRole: 'blue' | 'white' | 'unknown';
  ukeRole: 'blue' | 'white' | 'unknown';
  observations: string[];
  missingEvidence: string[];
  confidenceBand: 'low' | 'medium' | 'high';
};
```

Adapt to the chosen rule set. A fixed schema makes the output parseable, not correct: validate timestamps against clip bounds; validate score labels against ruleset; check that `endMs >= startMs`; reject malformed/refusal/incomplete API responses; and route low-confidence/contradictory evidence to review. Do not expose internal hidden reasoning—store concise observable evidence and audit metadata instead.

Never call an LLM's number a calibrated probability without measuring calibration on held-out data. If the camera misses landing/contact, output `uncertain`, not a forced score. Show citations to evidence timestamps and short extracted clips/frame stills in the result UI.

## 4. OpenAI API practices

- Keep `OPENAI_API_KEY` server-side; never prefix it with `NEXT_PUBLIC_` or return it to the browser.
- Use the official JS/TS SDK and Responses API/vision input documented for the chosen current model; pin model identifiers where supported and record them.
- Bound concurrency, images per request, retries, timeouts, and spend. Respect rate-limit headers and use backoff for retryable failures; do not retry permanent invalid-input errors.
- Minimize frames sent (cost and privacy). Create a contact sheet only if it preserves enough detail; keep action sequences in chronological order.
- Review data retention for image/file inputs and endpoint state. Uploaded API files can persist until deleted/expired; prefer ephemeral inline image inputs if practical and verify current policies.

## 5. Testing

Test known fixtures for accurate timestamp mapping (including variable-frame-rate and rotated videos), cuts/replays, off-screen or occluded landings, low FPS, malformed files, very long files, API timeouts/rate limits, refusal/incomplete outputs, duplicate jobs, and deletion. Maintain a tiny synthetic/dev fixture set separately from private production videos.

## References

- OpenAI vision: https://developers.openai.com/api/docs/guides/vision
- OpenAI Structured Outputs: https://developers.openai.com/api/docs/guides/structured-outputs
- OpenAI models: https://developers.openai.com/api/docs/models
- OpenAI rate limits: https://developers.openai.com/api/docs/guides/rate-limits
- OpenAI data controls: https://developers.openai.com/api/docs/guides/your-data
- Cookbook video-frame example (archived): https://developers.openai.com/cookbook/examples/gpt_with_vision_for_video_understanding
- FFmpeg documentation: https://ffmpeg.org/documentation.html
