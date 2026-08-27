import { checkBounces } from "@/lib/bounce-checker";
import { claimDueEmails, recordEmailResult, releaseEmail } from "@/lib/campaigns";
import { reserveSendSlot } from "@/lib/send-rate-limiter";
import { sendMailDirect } from "@/lib/send-mail";

export const runtime = "nodejs";
// Ask for the most headroom the platform allows (Hobby's default is much
// shorter) since each due email costs a real SMTP round trip.
export const maxDuration = 60;

// One at a time — an external cron pings this every ~1 minute anyway, so
// throughput comes from tick frequency, not batch size. Keeping this at 1
// bounds each invocation's blast radius to a single real SMTP round trip:
// if a batch of 3 sequential sends occasionally ran long enough to hit the
// 60s maxDuration below, Vercel would kill the invocation after a rate-limit
// slot was reserved for one of them but before its result got recorded,
// wasting that slot (it only gets picked back up 2 minutes later via
// claimDueEmails' stuck-row retry, by which point it costs a second slot).
const BATCH_SIZE = 1;

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
    const rateLimit = await reserveSendSlot("campaign");
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

  // Best-effort and self-throttling (see checkBounces) — runs after the real
  // send work so a slow/unreachable IMAP server never delays actual sends.
  await checkBounces();

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
