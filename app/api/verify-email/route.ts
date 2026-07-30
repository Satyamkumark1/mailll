import { deepVerify } from "@/lib/smtp-verifier";
import { mapWithConcurrency } from "@/lib/concurrency";
import type { EmailStatus } from "@/lib/store";

export const runtime = "nodejs";

const CONCURRENCY = 5;
const ABSTRACT_API_BATCH_LIMIT = 20;

// Vercel blocks outbound port 25, which deepVerify() needs for live SMTP
// checks. Three ways to get a real answer anyway, tried in order:
//  1. ABSTRACT_API_KEY set -> call Abstract API's HTTPS verification endpoint
//     (no infra, free tier ~100/month).
//  2. VERIFIER_SERVICE_URL set -> proxy to a self-hosted verifier (e.g. a VPS
//     with port 25 unblocked) running the same deepVerify logic.
//  3. Neither set (e.g. local dev, where port 25 is often open) -> run
//     deepVerify in-process exactly as before.
const ABSTRACT_API_KEY = process.env.ABSTRACT_API_KEY;
const VERIFIER_SERVICE_URL = process.env.VERIFIER_SERVICE_URL;
const VERIFIER_SHARED_SECRET = process.env.VERIFIER_SHARED_SECRET;

async function verifyViaAbstractApi(email: string): Promise<{ status: EmailStatus; reason: string }> {
  try {
    const url = `https://emailreputation.abstractapi.com/v1/?api_key=${ABSTRACT_API_KEY}&email=${encodeURIComponent(email)}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
    if (!res.ok) {
      return { status: "flagged", reason: `Abstract API error (${res.status})` };
    }
    const data = await res.json();
    const status = data.email_deliverability?.status as string | undefined;
    const isCatchall = data.email_quality?.is_catchall === true;

    if (status === "deliverable") {
      return {
        status: isCatchall ? "flagged" : "valid",
        reason: isCatchall ? "Catch-all domain — mailbox cannot be individually confirmed" : "Abstract API: deliverable",
      };
    }
    if (status === "undeliverable") {
      return {
        status: "invalid",
        reason: data.email_deliverability?.is_mx_valid === false ? "Domain has no mail server" : "Abstract API: undeliverable",
      };
    }
    return { status: "flagged", reason: "Abstract API: unknown — verify manually" };
  } catch (err) {
    return { status: "flagged", reason: err instanceof Error ? err.message : "Abstract API unreachable" };
  }
}

async function verifyViaService(emails: string[]) {
  const res = await fetch(VERIFIER_SERVICE_URL!, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(VERIFIER_SHARED_SECRET ? { Authorization: `Bearer ${VERIFIER_SHARED_SECRET}` } : {}),
    },
    body: JSON.stringify({ emails }),
    signal: AbortSignal.timeout(60000),
  });
  if (!res.ok) {
    throw new Error(`Verifier service responded ${res.status}`);
  }
  return (await res.json()).results;
}

export async function POST(request: Request) {
  const { emails } = await request.json();
  if (!Array.isArray(emails) || emails.length === 0) {
    return Response.json({ error: "emails must be a non-empty array" }, { status: 400 });
  }

  if (ABSTRACT_API_KEY) {
    if (emails.length > ABSTRACT_API_BATCH_LIMIT) {
      return Response.json(
        { error: `Abstract API is limited to ${ABSTRACT_API_BATCH_LIMIT} emails per request — split into smaller batches` },
        { status: 400 }
      );
    }
    const results = await mapWithConcurrency(emails as string[], CONCURRENCY, async (email) => ({
      email,
      ...(await verifyViaAbstractApi(email)),
    }));
    return Response.json({ results });
  }

  if (VERIFIER_SERVICE_URL) {
    try {
      const results = await verifyViaService(emails as string[]);
      return Response.json({ results });
    } catch (err) {
      return Response.json(
        { error: err instanceof Error ? err.message : "Verifier service unreachable" },
        { status: 502 }
      );
    }
  }

  const results = await mapWithConcurrency(emails as string[], CONCURRENCY, async (email) => ({
    email,
    ...(await deepVerify(email)),
  }));

  return Response.json({ results });
}
