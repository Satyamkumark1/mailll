import { sql } from "./db.ts";
import { computeScheduledTimes } from "./campaign-schedule.ts";
import { buildEmailHtml, LOGO_CID } from "./email-signature.ts";
import { MAX_CONSECUTIVE_SEND_FAILURES, type DraftResult, type OutreachConfig } from "./store.ts";

export type CampaignStatus = "running" | "completed" | "canceled";
export type CampaignEmailStatus = "pending" | "sending" | "sent" | "failed" | "canceled" | "skipped";

export type DeliveryStatus = "delivered" | "bounced" | null;

export interface CampaignEmailSummary {
  id: string;
  email: string;
  status: CampaignEmailStatus;
  error: string | null;
  sentAt: string | null;
  scheduledAt: string;
  // Only meaningful once status = 'sent' — see lib/bounce-checker.ts. Sending
  // successfully (status = 'sent') just means the SMTP server accepted the
  // message; this is filled in later, asynchronously, once the mailbox
  // either bounces it or enough time passes with no bounce to infer delivery.
  deliveryStatus: DeliveryStatus;
  bounceReason: string | null;
  // Which sender account actually attempted this send — only set once the
  // row is claimed and dispatched (accounts are picked dynamically at send
  // time, not when the campaign is scheduled), so pending rows show null.
  accountLabel: string | null;
}

export interface CampaignListItem {
  id: string;
  status: CampaignStatus;
  createdAt: string;
  windowStart: string;
  windowEnd: string;
  totalCount: number;
  sentCount: number;
  failedCount: number;
  skippedCount: number;
}

export interface CampaignSummary extends CampaignListItem {
  consecutiveFailures: number;
  emails: CampaignEmailSummary[];
}

export interface CreateCampaignInput {
  drafts: DraftResult[];
  config: OutreachConfig;
  durationHours: number;
  // Optional future start time (ISO string). Omitted, or in the past,
  // means "start now" — we never silently schedule into the past.
  startAt?: string;
}

export async function createCampaign({ drafts, config, durationHours, startAt }: CreateCampaignInput): Promise<string> {
  const now = new Date();
  const requestedStart = startAt ? new Date(startAt) : now;
  const windowStart = requestedStart.getTime() > now.getTime() ? requestedStart : now;
  const windowEnd = new Date(windowStart.getTime() + durationHours * 3600_000);
  const scheduledTimes = computeScheduledTimes(drafts.length, windowStart, windowEnd);

  const [campaign] = await sql`
    INSERT INTO campaigns (window_start, window_end, total_count)
    VALUES (${windowStart.toISOString()}, ${windowEnd.toISOString()}, ${drafts.length})
    RETURNING id
  `;
  const campaignId = campaign.id as string;

  // The Neon serverless driver is HTTP-based (one round trip per query, no
  // persistent connection) — inserting hundreds of rows one at a time here
  // would mean hundreds of sequential round trips, easily blowing past a
  // Vercel Hobby function's default timeout. unnest() turns it into one.
  const toEmails = drafts.map((d) => d.email);
  const subjects = drafts.map((d) => d.subject);
  const bodies = drafts.map((d) => d.body);
  const htmls = drafts.map((d) => buildEmailHtml(config, d.body, `cid:${LOGO_CID}`));
  const scheduledAt = scheduledTimes.map((t) => t.toISOString());

  await sql`
    INSERT INTO campaign_emails (campaign_id, to_email, subject, body, html, scheduled_at)
    SELECT ${campaignId}, * FROM unnest(
      ${toEmails}::text[],
      ${subjects}::text[],
      ${bodies}::text[],
      ${htmls}::text[],
      ${scheduledAt}::timestamptz[]
    )
  `;

  return campaignId;
}

export async function listCampaigns(limit = 50): Promise<CampaignListItem[]> {
  const rows = await sql`
    SELECT id, status, created_at, window_start, window_end, total_count, sent_count, failed_count, skipped_count
    FROM campaigns
    ORDER BY created_at DESC
    LIMIT ${limit}
  `;
  return rows.map((c) => ({
    id: c.id as string,
    status: c.status as CampaignStatus,
    createdAt: c.created_at as string,
    windowStart: c.window_start as string,
    windowEnd: c.window_end as string,
    totalCount: c.total_count as number,
    sentCount: c.sent_count as number,
    failedCount: c.failed_count as number,
    skippedCount: c.skipped_count as number,
  }));
}

export async function getCampaign(id: string): Promise<CampaignSummary | null> {
  const [campaign] = await sql`SELECT * FROM campaigns WHERE id = ${id}`;
  if (!campaign) return null;

  const emails = await sql`
    SELECT ce.id, ce.to_email, ce.status, ce.error, ce.sent_at, ce.scheduled_at, ce.delivery_status, ce.bounce_reason, sa.label AS account_label
    FROM campaign_emails ce
    LEFT JOIN sender_accounts sa ON sa.id = ce.account_id
    WHERE ce.campaign_id = ${id}
    ORDER BY ce.scheduled_at ASC
  `;

  return {
    id: campaign.id as string,
    status: campaign.status as CampaignStatus,
    createdAt: campaign.created_at as string,
    windowStart: campaign.window_start as string,
    windowEnd: campaign.window_end as string,
    totalCount: campaign.total_count as number,
    sentCount: campaign.sent_count as number,
    failedCount: campaign.failed_count as number,
    skippedCount: campaign.skipped_count as number,
    consecutiveFailures: campaign.consecutive_failures as number,
    emails: emails.map((e) => ({
      id: e.id as string,
      email: e.to_email as string,
      status: e.status as CampaignEmailStatus,
      error: (e.error as string | null) ?? null,
      sentAt: (e.sent_at as string | null) ?? null,
      scheduledAt: e.scheduled_at as string,
      deliveryStatus: (e.delivery_status as DeliveryStatus) ?? null,
      bounceReason: (e.bounce_reason as string | null) ?? null,
      accountLabel: (e.account_label as string | null) ?? null,
    })),
  };
}

export async function cancelCampaign(id: string): Promise<void> {
  await sql`
    UPDATE campaign_emails SET status = 'canceled'
    WHERE campaign_id = ${id} AND status = 'pending'
  `;
  await sql`
    UPDATE campaigns SET status = 'canceled'
    WHERE id = ${id} AND status = 'running'
  `;
}

// Distinct from account-level pause/resume (lib/sender-accounts.ts): cancelCampaign() already flipped this
// campaign's un-sent rows to 'canceled' with stale (likely past) scheduled_at
// times, so bringing it back needs a real reschedule — not just flipping the
// campaign status bit — or the cron would immediately try to "catch up" on
// every one of them at once instead of pacing them again.
export async function restartCampaign(id: string, durationHours: number): Promise<void> {
  const [campaign] = await sql`SELECT status FROM campaigns WHERE id = ${id}`;
  if (!campaign || campaign.status !== "canceled") {
    throw new Error("Only a canceled campaign can be restarted");
  }

  const canceledEmails = await sql`
    SELECT id FROM campaign_emails WHERE campaign_id = ${id} AND status = 'canceled'
  `;
  if (canceledEmails.length === 0) {
    throw new Error("No canceled emails left to restart");
  }

  const now = new Date();
  const windowEnd = new Date(now.getTime() + durationHours * 3600_000);
  const scheduledTimes = computeScheduledTimes(canceledEmails.length, now, windowEnd);
  const ids = canceledEmails.map((e) => e.id as string);
  const scheduledAt = scheduledTimes.map((t) => t.toISOString());

  await sql`
    UPDATE campaign_emails AS ce
    SET status = 'pending', scheduled_at = data.scheduled_at
    FROM (SELECT * FROM unnest(${ids}::uuid[], ${scheduledAt}::timestamptz[]) AS t(id, scheduled_at)) AS data
    WHERE ce.id = data.id
  `;

  await sql`
    UPDATE campaigns
    SET status = 'running', window_start = ${now.toISOString()}, window_end = ${windowEnd.toISOString()}, consecutive_failures = 0
    WHERE id = ${id}
  `;
}

// Pulls specific still-pending rows out of a running campaign without
// touching the rest — distinct from cancelCampaign (which takes out every
// pending row) and tracked as its own status so these never get swept up by
// restartCampaign (which only looks at 'canceled' rows).
export async function skipCampaignEmails(campaignId: string, emailIds: string[]): Promise<number> {
  const updated = await sql`
    UPDATE campaign_emails SET status = 'skipped'
    WHERE campaign_id = ${campaignId} AND status = 'pending' AND id = ANY(${emailIds}::uuid[])
    RETURNING id
  `;
  if (updated.length === 0) return 0;

  await sql`UPDATE campaigns SET skipped_count = skipped_count + ${updated.length} WHERE id = ${campaignId}`;

  // Mirrors the same "did this empty out the remaining queue" check at the
  // end of recordEmailResult, so skipping the last pending rows correctly
  // flips the campaign to completed instead of leaving it stuck at 'running'
  // with nothing left to claim.
  const [remaining] = await sql`
    SELECT count(*)::int AS n FROM campaign_emails WHERE campaign_id = ${campaignId} AND status IN ('pending', 'sending')
  `;
  if ((remaining.n as number) === 0) {
    await sql`UPDATE campaigns SET status = 'completed' WHERE id = ${campaignId} AND status = 'running'`;
  }

  return updated.length;
}

export interface DueEmail {
  id: string;
  campaignId: string;
  toEmail: string;
  subject: string;
  body: string;
  html: string;
}

// One claimed email's dispatch outcome in a cron tick — see
// app/api/cron/tick/route.ts's sendOne().
export type DispatchOutcome = "sent" | "failed" | "deferred";

export interface DispatchSummary {
  sent: number;
  failed: number;
  deferred: number;
  // A dispatch promise rejected outright — something threw before any of
  // the above outcomes could be recorded (e.g. a transient DB error inside
  // reserveSendSlot or recordEmailResult), as opposed to a normal
  // rate-limit defer or a caught send failure. Counted separately so the
  // tick's totals stay honest (sent+failed+deferred+errored should match
  // how many rows were claimed) instead of silently dropping them.
  errored: number;
}

// Pure — no DB access, so this is testable without a Postgres connection
// unlike the rest of this file. The caller is still responsible for
// recovering each rejected row (releaseEmail) — this only tallies.
export function summarizeDispatchResults(results: PromiseSettledResult<DispatchOutcome>[]): DispatchSummary {
  const summary: DispatchSummary = { sent: 0, failed: 0, deferred: 0, errored: 0 };
  for (const r of results) {
    if (r.status === "fulfilled") summary[r.value]++;
    else summary.errored++;
  }
  return summary;
}

// Locks and returns up to `limit` due rows across all running campaigns so
// an overlapping cron invocation can't double-send the same email.
export async function claimDueEmails(limit: number): Promise<DueEmail[]> {
  const rows = await sql`
    WITH due AS (
      SELECT ce.id
      FROM campaign_emails ce
      JOIN campaigns c ON c.id = ce.campaign_id
      WHERE c.status = 'running'
        AND ce.scheduled_at <= now()
        AND (
          ce.status = 'pending'
          -- a row stuck in 'sending' means a prior tick claimed it but never
          -- recorded a result (e.g. hit the function timeout) — retry it.
          OR (ce.status = 'sending' AND ce.scheduled_at <= now() - interval '2 minutes')
        )
      ORDER BY ce.scheduled_at ASC
      LIMIT ${limit}
      FOR UPDATE OF ce SKIP LOCKED
    )
    UPDATE campaign_emails
    SET status = 'sending'
    FROM due
    WHERE campaign_emails.id = due.id
    RETURNING campaign_emails.id, campaign_emails.campaign_id, campaign_emails.to_email,
      campaign_emails.subject, campaign_emails.body, campaign_emails.html
  `;
  return rows.map((r) => ({
    id: r.id as string,
    campaignId: r.campaign_id as string,
    toEmail: r.to_email as string,
    subject: r.subject as string,
    body: r.body as string,
    html: r.html as string,
  }));
}

// Puts a claimed-but-not-yet-sent row back to pending (e.g. rate limit hit)
// so it's retried on a later tick.
export async function releaseEmail(id: string): Promise<void> {
  await sql`UPDATE campaign_emails SET status = 'pending' WHERE id = ${id} AND status = 'sending'`;
}

// Two consecutive failures on the same account means something about that
// account is actually broken (bad creds, blocked domain) rather than
// one-off bounces — pause it alone so the other accounts keep sending,
// instead of burning through sends on a mailbox that's already failing.
export function shouldPauseAccount(consecutiveFailures: number): boolean {
  return consecutiveFailures >= MAX_CONSECUTIVE_SEND_FAILURES;
}

export async function recordEmailResult(
  id: string,
  campaignId: string,
  accountId: number,
  result: { status: "sent"; } | { status: "failed"; error: string }
): Promise<void> {
  if (result.status === "sent") {
    await sql`UPDATE campaign_emails SET status = 'sent', sent_at = now(), account_id = ${accountId} WHERE id = ${id}`;
    await sql`UPDATE campaigns SET sent_count = sent_count + 1, consecutive_failures = 0 WHERE id = ${campaignId}`;
    await sql`UPDATE sender_accounts SET consecutive_failures = 0 WHERE id = ${accountId}`;
  } else {
    await sql`UPDATE campaign_emails SET status = 'failed', error = ${result.error}, account_id = ${accountId} WHERE id = ${id}`;
    await sql`UPDATE campaigns SET failed_count = failed_count + 1, consecutive_failures = consecutive_failures + 1 WHERE id = ${campaignId}`;
    const [account] = await sql`
      UPDATE sender_accounts SET consecutive_failures = consecutive_failures + 1
      WHERE id = ${accountId}
      RETURNING consecutive_failures
    `;
    if (account && shouldPauseAccount(account.consecutive_failures as number)) {
      await sql`UPDATE sender_accounts SET status = 'paused' WHERE id = ${accountId}`;
    }
  }

  const [remaining] = await sql`
    SELECT count(*)::int AS n FROM campaign_emails WHERE campaign_id = ${campaignId} AND status IN ('pending', 'sending')
  `;
  if ((remaining.n as number) === 0) {
    await sql`UPDATE campaigns SET status = 'completed' WHERE id = ${campaignId} AND status = 'running'`;
  }
}
