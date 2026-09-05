import { checkBounces } from "@/lib/bounce-checker";
import {
  claimDueEmails,
  recordEmailResult,
  releaseEmail,
  summarizeDispatchResults,
  type DispatchOutcome,
  type DueEmail,
} from "@/lib/campaigns";
import { listAccounts, type SenderAccount } from "@/lib/sender-accounts";
import { peekAccountRateLimitStatus, pickLeastLoadedAccount, reserveSendSlot, type AccountLoad } from "@/lib/send-rate-limiter";
import { sendMailDirect } from "@/lib/send-mail";
import { logActivity } from "@/lib/activity-log";

export const runtime = "nodejs";
// Ask for the most headroom the platform allows (Hobby's default is much
// shorter) since each due email costs a real SMTP round trip.
export const maxDuration = 60;

// One claimed row per currently-healthy account (capped regardless of how
// many accounts exist), dispatched concurrently. An external cron pings
// this endpoint every ~1 minute — with a single account and a batch of 1,
// that's a ceiling of ~1,440 emails/day, already below a multi-thousand/day
// combined target across several accounts. Scaling the batch to the
// account count and sending in parallel (not a sequential loop) raises that
// ceiling without reintroducing the risk a sequential multi-send batch
// would have: wall-clock time per tick stays close to the single slowest
// send, not the sum, so maxDuration risk doesn't grow with account count.
const MAX_BATCH_SIZE = 10;

function isAuthorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const url = new URL(request.url);
  const queryToken = url.searchParams.get("secret");
  const header = request.headers.get("authorization");
  const bearerToken = header?.startsWith("Bearer ") ? header.slice("Bearer ".length) : null;
  return queryToken === secret || bearerToken === secret;
}

async function sendOne(email: DueEmail, account: SenderAccount): Promise<DispatchOutcome> {
  // The live DB check here — not the in-memory snapshot used to pick this
  // account — is the sole authority on whether this send is actually
  // allowed. A stale snapshot can produce a suboptimal pick, never a cap
  // breach: if this account and its slot already got used elsewhere between
  // the snapshot and now, this simply defers instead of over-sending.
  const reservation = await reserveSendSlot(account, "campaign");
  if (!reservation.allowed) {
    await releaseEmail(email.id);
    return "deferred";
  }

  try {
    await sendMailDirect(account, { to: email.toEmail, subject: email.subject, text: email.body, html: email.html, emailId: email.id });
    await recordEmailResult(email.id, email.campaignId, account.id, email.toEmail, { status: "sent" });
    return "sent";
  } catch (err) {
    await recordEmailResult(email.id, email.campaignId, account.id, email.toEmail, {
      status: "failed",
      error: err instanceof Error ? err.message : "Send failed",
    });
    return "failed";
  }
}

async function tick() {
  const accounts = await listAccounts();
  const active = accounts.filter((a) => a.status === "active");

  const snapshots = await Promise.all(
    active.map(async (account) => ({ account, status: await peekAccountRateLimitStatus(account) }))
  );
  const healthy = snapshots.filter((s) => s.status.allowed);

  if (healthy.length === 0) {
    // Best-effort and self-throttling — runs even when nothing can send so
    // bounce confirmations keep flowing.
    await checkBounces();
    await logActivity({
      actorType: "system",
      actorLabel: "cron-tick",
      action: "cron.tick",
      summary: "Tick: no healthy accounts, claimed 0, sent 0, failed 0, deferred 0",
      metadata: { claimed: 0, sent: 0, failed: 0, deferred: 0, healthyAccounts: 0 },
    });
    return { claimed: 0, sent: 0, failed: 0, deferred: 0 };
  }

  const due = await claimDueEmails(MAX_BATCH_SIZE, healthy.map((h) => h.account.id));

  const loadById = new Map<number, AccountLoad>(
    healthy.map((h) => [
      h.account.id,
      {
        accountId: h.account.id,
        hourlyUsed: h.status.hourly.used,
        hourlyCap: h.status.hourly.cap,
        dailyUsed: h.status.daily.used,
        dailyCap: h.status.daily.cap,
      },
    ])
  );
  const accountById = new Map(healthy.map((h) => [h.account.id, h.account]));

  // Assigned synchronously, before any await, so concurrent dispatch below
  // can't all pick the same "most idle" account for different rows.
  const assignments = due.map((email) => {
    const accountId = email.senderAccountId ?? pickLeastLoadedAccount([...loadById.values()]);
    if (accountId !== null) {
      const load = loadById.get(accountId)!;
      load.hourlyUsed += 1;
      load.dailyUsed += 1;
    }
    return { email, accountId };
  });

  const results = await Promise.allSettled(
    assignments.map(({ email, accountId }): Promise<DispatchOutcome> => {
      const account = accountId !== null ? accountById.get(accountId) : undefined;
      return account ? sendOne(email, account) : releaseEmail(email.id).then((): DispatchOutcome => "deferred");
    })
  );

  // A rejected promise means something threw before sendOne (or the
  // no-account releaseEmail fallback above) could record any outcome at
  // all — e.g. a transient DB error inside reserveSendSlot or
  // recordEmailResult. Recover the claimed row with the same
  // claim-recovery policy as a rate-limit block (releaseEmail) instead of
  // leaving it to rot until claimDueEmails' passive 2-minute stuck-row
  // sweep, and log it — summarizeDispatchResults below counts it too, so
  // it isn't silently dropped from the tick's totals.
  await Promise.all(
    results.map((r, i) => {
      if (r.status !== "rejected") return undefined;
      console.error("Unhandled error dispatching email", assignments[i].email.id, ":", r.reason);
      return releaseEmail(assignments[i].email.id).catch((releaseErr) =>
        console.error("Failed to release claimed email", assignments[i].email.id, "after dispatch error:", releaseErr)
      );
    })
  );

  const summary = summarizeDispatchResults(results);

  // Best-effort and self-throttling (see checkBounces) — runs after the real
  // send work so a slow/unreachable IMAP server never delays actual sends.
  await checkBounces();

  await logActivity({
    actorType: "system",
    actorLabel: "cron-tick",
    action: "cron.tick",
    summary: `Tick: claimed ${due.length}, sent ${summary.sent}, failed ${summary.failed}, deferred ${summary.deferred}`,
    metadata: { claimed: due.length, ...summary, healthyAccounts: healthy.length },
  });

  return { claimed: due.length, ...summary };
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
