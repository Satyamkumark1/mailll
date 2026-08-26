import { claimDueEmails, recordEmailResult, releaseEmail } from "@/lib/campaigns";
import { reserveSendSlot } from "@/lib/send-rate-limiter";
import { sendMailDirect } from "@/lib/send-mail";

export const runtime = "nodejs";
// Ask for the most headroom the platform allows (Hobby's default is much
// shorter) since each due email costs a real SMTP round trip.
export const maxDuration = 60;

// Small batch — an external cron pings this every ~1 minute anyway, so
// throughput comes from tick frequency, not batch size. Keeps each
// invocation well under typical serverless function time limits even
// though every row costs a real SMTP round trip.
const BATCH_SIZE = 3;

function isAuthorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const url = new URL(request.url);
  const queryToken = url.searchParams.get("secret");
  const header = request.headers.get("authorization");
  const bearerToken = header?.startsWith("Bearer ") ? header.slice("Bearer ".length) : null;
  return queryToken === secret || bearerToken === secret;
}

async function tick() {
  const due = await claimDueEmails(BATCH_SIZE);
  let sent = 0;
  let failed = 0;
  let deferred = 0;

  for (const email of due) {
    const rateLimit = await reserveSendSlot();
    if (!rateLimit.allowed) {
      await releaseEmail(email.id);
      deferred++;
      continue;
    }

    try {
      await sendMailDirect({ to: email.toEmail, subject: email.subject, text: email.body, html: email.html });
      await recordEmailResult(email.id, email.campaignId, { status: "sent" });
      sent++;
    } catch (err) {
      await recordEmailResult(email.id, email.campaignId, {
        status: "failed",
        error: err instanceof Error ? err.message : "Send failed",
      });
      failed++;
    }
  }

  return { claimed: due.length, sent, failed, deferred };
}

export async function GET(request: Request) {
  if (!isAuthorized(request)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  return Response.json(await tick());
}

export async function POST(request: Request) {
  if (!isAuthorized(request)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  return Response.json(await tick());
}
