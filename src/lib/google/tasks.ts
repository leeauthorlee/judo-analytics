import "server-only";
import { getVercelOidcToken } from "@vercel/oidc";
import { ExternalAccountClient } from "google-auth-library";

const externalAccountConfig = {
  type: "external_account" as const,
  audience: `//iam.googleapis.com/projects/${process.env.GCP_PROJECT_NUMBER}/locations/global/workloadIdentityPools/${process.env.GCP_WORKLOAD_IDENTITY_POOL_ID}/providers/${process.env.GCP_WORKLOAD_IDENTITY_POOL_PROVIDER_ID}`,
  subject_token_type: "urn:ietf:params:oauth:token-type:jwt",
  token_url: "https://sts.googleapis.com/v1/token",
  service_account_impersonation_url: `https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/${process.env.GOOGLE_CLOUD_TASKS_SERVICE_ACCOUNT}:generateAccessToken`,
  subject_token_supplier: {
    getSubjectToken: () => getVercelOidcToken(),
  },
};

export function isAnalysisQueueConfigured() {
  return Boolean(
    process.env.GOOGLE_CLOUD_PROJECT &&
      process.env.GOOGLE_CLOUD_TASKS_LOCATION &&
      process.env.GOOGLE_CLOUD_TASKS_QUEUE &&
      process.env.GOOGLE_CLOUD_WORKER_URL &&
      process.env.GOOGLE_CLOUD_TASKS_SERVICE_ACCOUNT &&
      process.env.GCP_PROJECT_NUMBER &&
      process.env.GCP_WORKLOAD_IDENTITY_POOL_ID &&
      process.env.GCP_WORKLOAD_IDENTITY_POOL_PROVIDER_ID,
  );
}

async function getAccessToken() {
  if (!isAnalysisQueueConfigured()) throw new Error("Google Cloud OIDC configuration is incomplete");
  const client = ExternalAccountClient.fromJSON(externalAccountConfig);
  if (!client) throw new Error("Unable to create Google Cloud auth client");
  const token = await client.getAccessToken();
  if (!token.token) throw new Error("Google Cloud access token was not returned");
  return token.token;
}

export async function enqueueAnalysisTask(analysisId: string) {
  if (!isAnalysisQueueConfigured()) return false;
  const project = process.env.GOOGLE_CLOUD_PROJECT!;
  const location = process.env.GOOGLE_CLOUD_TASKS_LOCATION!;
  const queue = process.env.GOOGLE_CLOUD_TASKS_QUEUE!;
  const workerUrl = process.env.GOOGLE_CLOUD_WORKER_URL!.replace(/\/$/, "");
  const serviceAccountEmail = process.env.GOOGLE_CLOUD_TASKS_SERVICE_ACCOUNT!;
  const parent = `projects/${project}/locations/${location}/queues/${queue}`;
  const taskName = `${parent}/tasks/analysis-${analysisId}`;
  const accessToken = await getAccessToken();

  const response = await fetch(`https://cloudtasks.googleapis.com/v2/${parent}/tasks`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      task: {
        name: taskName,
        httpRequest: {
          httpMethod: "POST",
          url: `${workerUrl}/tasks`,
          headers: { "Content-Type": "application/json" },
          body: Buffer.from(JSON.stringify({ analysis_id: analysisId })).toString("base64"),
          oidcToken: { serviceAccountEmail, audience: workerUrl },
        },
      },
    }),
    signal: AbortSignal.timeout(10_000),
  });
  if (response.status === 409) return true;
  if (!response.ok) throw new Error(`Google Cloud Tasks rejected the job: ${response.status}`);
  return true;
}
