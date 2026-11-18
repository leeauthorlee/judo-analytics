# Next.js, Supabase, Vercel, and Google Cloud setup

The application uses Vercel for the Next.js control plane, Supabase Auth/Postgres, private Vercel Blob, Cloud Tasks and private Cloud Run. `worker/analysis-provider.js` now invokes the trained Python R3D-18 model for a user-selected interval of at most 30 seconds. It returns technique candidates only; landing and service scores require user confirmation. See [model integration](../architecture/model-integration.md).

## 1. Supabase project

1. Run both migrations in order: `202611180001_initial_schema.sql`, then `202611180002_model_integration.sql`. Existing projects only need the second migration. It adds selection inputs, manual reviews, the model registry entry and transactional result persistence.
2. Copy the project URL and the **publishable** key from the project Connect/API settings. Add them to Vercel and local `.env.local` as `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`.
3. In Authentication → URL Configuration, allow the local URL `http://localhost:3000/auth/callback` and the production URL `https://<your-domain>/auth/callback`.
4. Enable Google and Kakao under Authentication → Sign In / Providers. Put the OAuth client credentials in Supabase, not in this repository. In each identity provider's console, register Supabase's callback URL (`https://<project-ref>.supabase.co/auth/v1/callback`).
5. The app creates a profile and one member workspace on first successful OAuth sign-in. RLS policies scope user data to that workspace. The service-role key must never be added to Vercel's browser-visible `NEXT_PUBLIC_*` variables.
6. If this account will manage rights and expert labels, promote it to the analyst role using the Supabase SQL Editor after sign-in: `update public.profiles set role = 'analyst' where id = '<auth user UUID>';`. There is no client-side role editor.

**Naver login is not wired in this version.** The installed Supabase Auth provider contract exposes Google and Kakao but not Naver. Naver requires a separate supported OAuth/OIDC broker or a deliberate auth architecture change; the UI labels this rather than silently sending users into a broken flow.

The current application is member-login based. The requirements document's guest-session flow is not implemented in this deployment slice.

## 2. Vercel project

Import the Git repository into Vercel and set the production domain. Add the variables below to **Development, Preview, and Production** as appropriate; use separate Supabase/Blob/Cloud resources for non-production environments where possible.

| Variable | Source |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Supabase publishable key |
| `NEXT_PUBLIC_SITE_URL` | Exact app origin, e.g. `https://judo.example.com` |
| `BLOB_READ_WRITE_TOKEN` | Vercel Blob store token with private access |
| `GOOGLE_CLOUD_PROJECT` | Google Cloud project ID |
| `GOOGLE_CLOUD_TASKS_LOCATION` | Cloud Tasks queue region |
| `GOOGLE_CLOUD_TASKS_QUEUE` | Queue name, default `judo-analysis` |
| `GOOGLE_CLOUD_WORKER_URL` | Private Cloud Run service URL, without `/tasks` |
| `GOOGLE_CLOUD_TASKS_SERVICE_ACCOUNT` | Service account email used for Cloud Tasks OIDC tokens |
| `GCP_PROJECT_NUMBER` | Numeric Google Cloud project number (WIF audience) |
| `GCP_WORKLOAD_IDENTITY_POOL_ID` | Workload Identity Pool id that trusts Vercel OIDC (`vercel`) |
| `GCP_WORKLOAD_IDENTITY_POOL_PROVIDER_ID` | Workload Identity Pool provider id (`vercel`) |
| `WORKER_API_SECRET` | Shared secret the worker sends to `/api/worker/blob-url` |

Service account keys are intentionally **not** used: the organization policy `constraints/iam.disableServiceAccountKeyCreation` blocks key creation, and Vercel OIDC + Workload Identity Federation issues short-lived tokens instead. Do not commit `.env.local`, OAuth secrets, Blob tokens, or Supabase service-role keys. This project does not need a Supabase service-role key on Vercel; user-scoped server clients rely on RLS.

## 3. Google Cloud worker

Create a queue and service accounts in the same project/region. Grant the Vercel OIDC principal (`principal://iam.googleapis.com/projects/<number>/locations/global/workloadIdentityPools/vercel/subject/owner:<team>:project:<project>:environment:production`) `roles/iam.serviceAccountTokenCreator` on the enqueuer service account so it can mint short-lived tokens. Grant the enqueuer `roles/cloudtasks.enqueuer` and `roles/run.invoker`. Keep the worker service unauthenticated access disabled; Cloud Tasks supplies the OIDC token.

Build with `gcloud builds submit --tag <region>-docker.pkg.dev/<project>/judo-analytics/judo-worker:latest --ignore-file=.dockerignore .` from the repository root (the root `Dockerfile` is a copy of `worker/Dockerfile`). The build's service account needs `roles/storage.objectViewer` on the Cloud Build log bucket and `roles/artifactregistry.writer` on the repository. Place the trained artifact at `analysis-model/models/judo_r3d18.pt` first (it is not in Git). The image includes Python 3.11, CPU inference dependencies and FFmpeg; `numpy` is pinned to a Python 3.11-compatible version. Deploy privately to Cloud Run with 2 GiB memory, 2 CPUs and concurrency 4. Supply these secrets through Secret Manager / Cloud Run secret references:

| Worker variable | Source |
|---|---|
| `SUPABASE_URL` | Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase server-only secret key (`worker_server`) |
| `WEB_APP_URL` | Exact app origin; used to request short-lived Blob URLs |
| `WORKER_API_SECRET` | Same value as the Vercel variable of that name |

The worker does **not** hold a Blob token. It calls `POST <web-app-url>/api/worker/blob-url` with `x-worker-secret` and a validated storage path; the app returns a short-lived presigned URL that the worker uses to download the private video. Missing weights yield `MODEL_NOT_CONFIGURED`.

Cloud Tasks sends `POST <worker-url>/tasks` with an OIDC token and `{ "analysis_id": "..." }`. The worker loads `input_json.startMs/endMs`, validates media and calls the Python checkpoint. A DB transaction stores events, real-result highlights/diaries and `review_required` status. Use a 600-second request/dispatch deadline initially and configure retry limits; inference does not run inside Vercel.

## 4. OAuth provider setup checklist

- In Google Cloud Console, create a Web OAuth client and add the Supabase callback URL to Authorized redirect URIs. Add the resulting client ID/secret to Supabase's Google provider settings.
- In Kakao Developers, create/enable Kakao Login, configure the Supabase callback URL as the redirect URI, enable the required profile scopes, and enter the credentials in Supabase.
- Set the exact app callback URL in Supabase's redirect allow list. OAuth provider callbacks go to Supabase first; Supabase then returns to the app's `/auth/callback` route.
- Never paste OAuth secrets into chat. For local development, put them in the provider dashboard and put only the public Supabase URL/key in `.env.local`.

## 5. Verify before production

1. Run `npm run typecheck`, `npm run lint`, and `npm run build`.
2. Sign in through each enabled provider and confirm the `profiles` and `workspaces` rows are created.
3. Upload an authorized test MP4 below 500 MB. Confirm the Blob is private, a `video_assets` row appears, and a `video_analyses` row is queued.
4. Select one attack interval of at most 30 seconds. Confirm Cloud Tasks invokes the private worker, the job becomes `review_required`, and three technique candidates appear. Save a manual landing review and confirm model JSON is unchanged and the diary shows the user-confirmed score.
5. Sign in as another user and verify the first user's rows are invisible under RLS.

The upload UI checks file type/size and offers numeric attack interval selection. The worker validates MP4 and the 10-minute source limit, then enforces the 30-second analysis interval. Thumbnail creation and analysis highlights are implemented. Account/session retention, guest access and production quotas remain follow-up requirements. No automatic landing or official scoring model is connected.
