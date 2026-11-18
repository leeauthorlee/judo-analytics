---
name: Judo Analysis Web Platform
description: Build the Next.js App Router product on Vercel: secure MP4 upload, job lifecycle, results UI, storage, and background processing.
---

# Next.js/Vercel implementation guide

Use for the product UI, API/Route Handlers, upload/storage, job status, deployment, or background processing.

## Preferred MVP architecture

- Next.js App Router for upload UI, job creation/status/results, and authenticated Route Handlers.
- Vercel Blob **private** store for source videos and derived evidence.
- Browser-to-Blob client upload for large MP4s; the server authorizes the user and issues a scoped upload token. Do not proxy a large video through a Vercel Function.
- A database (choose and document one) for user ownership, file metadata, rule/model versions, job state, result events, and deletion state.
- Queue + durable worker for FFprobe/FFmpeg and model requests. Use Vercel Queues/Workflows/Daemons if supported for the project plan and workload, or a separate container/GPU service. Do not make a multi-minute analysis depend on one browser request.
- UI polls a job endpoint or uses a suitable event stream and displays `uploaded → queued → processing → review_required/completed/failed`.

Vercel's current Blob documentation says Function server uploads have a 4.5 MB body limit and recommends client uploads for larger files. Its background-worker guide specifically describes browser-to-Blob upload → queue/worker with FFmpeg → save result and job status. Confirm current product beta status, plan quotas, runtime, regions, and cost before relying on any worker product.

## Routes and trust boundaries

Use Route Handlers in `app/api/.../route.ts` for request/response boundaries. Suggested endpoints:

- `POST /api/uploads/token`: authenticate, authorize quota, allow only MP4-compatible MIME types, limit size, mint short-lived upload capability for a generated object path.
- `POST /api/uploads/complete`: verify Blob callback/signature or server-side object metadata, persist record, enqueue an idempotent job.
- `GET /api/analyses/:id`: authorize owner and return job state/result; never trust an arbitrary blob URL supplied by the client.
- `DELETE /api/analyses/:id`: authorized deletion of DB row, original video, derived frames/clips, and applicable provider-side files.

Apply authentication/authorization to every endpoint and upload token. Validate callback events, content type and object ownership server-side. Use CSRF protections as appropriate for the auth setup, per-user quotas, request throttles, and safe error messages. Prevent SSRF if a worker ever fetches URLs; accept storage object IDs owned by the application, not arbitrary user URLs.

## Upload behavior

- Validate extension for UX but do not trust it as proof of file type; inspect the media server-side.
- Set maximum byte size and duration before enqueueing; reject unsupported codecs/resolutions and tell users how to convert.
- Use private object storage for user/broadcast footage. Do not show unguessable-but-public URLs as an access-control mechanism.
- Sanitize display filenames; keep the original name only as optional metadata.
- Show upload progress, cancellation, resumable/retry behavior if supported, and a clear state when upload completed but analysis has not started.
- Upload tokens must be narrowly scoped to one generated object, accepted types, expiry, and byte limits supported by the SDK.

## Background analysis

Keep Next.js Functions as control plane; worker performs FFprobe/FFmpeg and model work. Persist job status/progress in a database, lease/lock or deduplicate jobs by analysis ID, implement bounded retries and dead-letter/manual retry paths, and tolerate worker restarts. Store derived evidence and clean it up with the source.

Vercel Function `maxDuration` is not a substitute for a durable queue/worker. Check the current limits and configured plan. If running a standalone worker outside Vercel, document where it is hosted, how it authenticates to storage/DB, GPU needs, secrets, and costs.

## User experience and responsible presentation

- Show MP4 constraints before upload.
- Present each event in timeline order with technique, estimated score, timestamps, confidence band, and evidence clip/stills.
- Distinguish “AI estimate” from “official referee result”; show rule set and analysis timestamp.
- Add “insufficient view / manual review needed” and correction/report mechanisms.
- Do not expose athlete identity inference or claim official adjudication.
- Include consent/rights notice, retention period, deletion control, and privacy contact.

## Environment and deployment

- Keep OpenAI, database, Blob, auth, and queue credentials in server-only environment variables and Vercel project secrets.
- Use separate local/preview/production stores, DBs, and API projects where practical. Never use production footage in preview by default.
- Verify `vercel build`/Next build, typecheck, lint, route auth tests, and a full upload-to-result smoke test in preview.
- Monitor job age/failures, worker retries, storage growth, API usage/cost, and redacted provider errors. Never log raw API keys, signed URLs, or whole private video payloads.

## References

- OpenCode skill format (this directory's discovery): https://opencode.ai/docs/skills
- Next.js Route Handlers: https://nextjs.org/docs/app/api-reference/file-conventions/route
- Vercel Blob client uploads: https://vercel.com/docs/vercel-blob/client-upload
- Vercel Blob private storage: https://vercel.com/docs/vercel-blob/private-storage
- Vercel background workers: https://vercel.com/docs/background-workers
- Vercel Function duration: https://vercel.com/docs/functions/configuring-functions/duration
- Vercel Function limitations: https://vercel.com/docs/functions/limitations
