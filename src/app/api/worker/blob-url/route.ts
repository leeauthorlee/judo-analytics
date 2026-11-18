import { NextResponse } from "next/server";
import { issueSignedToken, presignUrl } from "@vercel/blob";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const secret = process.env.WORKER_API_SECRET;
  if (!secret || request.headers.get("x-worker-secret") !== secret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  let body: { pathname?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
  const pathname = body.pathname;
  if (typeof pathname !== "string" || !/^workspaces\/[a-f0-9-]{36}\/[a-f0-9-]{36}\.mp4$/i.test(pathname)) {
    return NextResponse.json({ error: "Invalid pathname" }, { status: 400 });
  }
  try {
    const signed = await issueSignedToken({ pathname, operations: ["get"] });
    const presigned = await presignUrl(signed, { operation: "get", pathname, access: "private" });
    return NextResponse.json({ url: presigned.presignedUrl });
  } catch {
    return NextResponse.json({ error: "Unable to sign blob URL" }, { status: 502 });
  }
}
