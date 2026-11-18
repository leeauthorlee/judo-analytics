import "server-only";
import { createSign } from "node:crypto";

type GoogleServiceAccount = {
  client_email: string;
  private_key: string;
  token_uri?: string;
};

function encodeBase64Url(value: string) {
  return Buffer.from(value).toString("base64url");
}

async function getAccessToken(credentials: GoogleServiceAccount) {
  const tokenUri = credentials.token_uri ?? "https://oauth2.googleapis.com/token";
  const issuedAt = Math.floor(Date.now() / 1000);
  const unsignedToken = [
    encodeBase64Url(JSON.stringify({ alg: "RS256", typ: "JWT" })),
    encodeBase64Url(JSON.stringify({
      iss: credentials.client_email,
      scope: "https://www.googleapis.com/auth/cloud-platform",
      aud: tokenUri,
      iat: issuedAt,
      exp: issuedAt + 3600,
    })),
  ].join(".");
  const signature = createSign("RSA-SHA256").update(unsignedToken).sign(credentials.private_key, "base64url");
  const assertion = `${unsignedToken}.${signature}`;
  const response = await fetch(tokenUri, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error("Google Cloud authentication failed");
  const token = await response.json() as { access_token?: unknown };
  if (typeof token.access_token !== "string") throw new Error("Google Cloud access token was not returned");
  return token.access_token;
}

export async function enqueueAnalysisTask(analysisId: string) {
  const project = process.env.GOOGLE_CLOUD_PROJECT;
  const location = process.env.GOOGLE_CLOUD_TASKS_LOCATION;
  const queue = process.env.GOOGLE_CLOUD_TASKS_QUEUE;
  const workerUrl = process.env.GOOGLE_CLOUD_WORKER_URL;
  const serviceAccountEmail = process.env.GOOGLE_CLOUD_TASKS_SERVICE_ACCOUNT;
  const credentialsJson = process.env.GOOGLE_CLOUD_SERVICE_ACCOUNT_JSON;

  if (!project || !location || !queue || !workerUrl || !serviceAccountEmail || !credentialsJson) {
    return false;
  }

  const credentials = JSON.parse(credentialsJson) as GoogleServiceAccount;
  if (!credentials.client_email || !credentials.private_key) {
    throw new Error("Google Cloud service account credentials are invalid");
  }
  const parent = `projects/${project}/locations/${location}/queues/${queue}`;
  const taskName = `${parent}/tasks/analysis-${analysisId}`;
  const normalizedWorkerUrl = workerUrl.replace(/\/$/, "");
  const accessToken = await getAccessToken(credentials);

  try {
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
            url: `${normalizedWorkerUrl}/tasks`,
            headers: { "Content-Type": "application/json" },
            body: Buffer.from(JSON.stringify({ analysis_id: analysisId })).toString("base64"),
            oidcToken: { serviceAccountEmail, audience: normalizedWorkerUrl },
          },
        },
      }),
      signal: AbortSignal.timeout(10_000),
    });
    if (response.status === 409) return true;
    if (!response.ok) throw new Error("Google Cloud Tasks rejected the job");
  } catch (error) {
    throw error;
  }

  return true;
}
