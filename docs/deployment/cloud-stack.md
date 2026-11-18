# Next.js, Supabase, Vercel, and Google Cloud setup

The application uses Vercel for the Next.js control plane, Supabase Auth/Postgres for accounts and persistent state, Vercel Blob private storage for uploaded MP4 files, Google Cloud Tasks for durable dispatch, and a private Cloud Run service for video work. The model adapter in `worker/analysis-provider.js` is intentionally empty; until it is implemented, jobs finish as `MODEL_NOT_CONFIGURED` rather than returning invented results.

## 1. Supabase project

1. Create a Supabase project and run `supabase/migrations/202611180001_initial_schema.sql` from the SQL Editor, or link the project with the Supabase CLI and run `supabase db push`.
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
| `GOOGLE_CLOUD_SERVICE_ACCOUNT_JSON` | Server-only service account JSON with permission to create tasks |

Do not commit `.env.local`, service account JSON, OAuth secrets, Blob tokens, or Supabase service-role keys. This project does not need a Supabase service-role key on Vercel; user-scoped server clients rely on RLS.

## 3. Google Cloud worker

Create a queue and service accounts in the same project/region. Grant the Vercel dispatcher identity permission to create Cloud Tasks. Grant the task OIDC service account `roles/run.invoker` on the Cloud Run worker and `roles/iam.serviceAccountUser` where required to mint the OIDC token. Keep the worker service unauthenticated access disabled.

Build and deploy the `worker/` directory as a Cloud Run service. Supply these secrets through Secret Manager / Cloud Run secret references:

| Worker variable | Source |
|---|---|
| `SUPABASE_URL` | Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase server-only service-role key |
| `BLOB_READ_WRITE_TOKEN` | Vercel Blob token that can read the private video store |

Cloud Tasks sends `POST <worker-url>/tasks` with an OIDC token and `{ "analysis_id": "..." }`. The worker reads the analysis/video records, fetches the private Blob object, invokes `analyzeVideo`, and persists results. The included adapter deliberately reports `MODEL_NOT_CONFIGURED` until replaced. Configure queue retry/dispatch deadlines and Cloud Run memory/timeout based on the eventual video/model workload; do not run inference in a Vercel request.

## 4. OAuth provider setup checklist

- In Google Cloud Console, create a Web OAuth client and add the Supabase callback URL to Authorized redirect URIs. Add the resulting client ID/secret to Supabase's Google provider settings.
- In Kakao Developers, create/enable Kakao Login, configure the Supabase callback URL as the redirect URI, enable the required profile scopes, and enter the credentials in Supabase.
- Set the exact app callback URL in Supabase's redirect allow list. OAuth provider callbacks go to Supabase first; Supabase then returns to the app's `/auth/callback` route.
- Never paste OAuth secrets into chat. For local development, put them in the provider dashboard and put only the public Supabase URL/key in `.env.local`.

## 5. Verify before production

1. Run `npm run typecheck`, `npm run lint`, and `npm run build`.
2. Sign in through each enabled provider and confirm the `profiles` and `workspaces` rows are created.
3. Upload an authorized test MP4 below 500 MB. Confirm the Blob is private, a `video_assets` row appears, and a `video_analyses` row is queued.
4. Confirm Cloud Tasks invokes the private Cloud Run service and the current empty adapter changes the job to `failed / MODEL_NOT_CONFIGURED`.
5. Sign in as another user and verify the first user's rows are invisible under RLS.

The upload UI checks the MP4 extension/MIME and 500 MB size; the Cloud Run worker validates the actual MP4 container and enforces the 10-minute duration before calling a model. The app does not yet create thumbnails, offer manual timeline-based highlight editing, or define account/session retention and expiry jobs. These remain follow-up production requirements.
