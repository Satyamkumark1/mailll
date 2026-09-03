import { randomUUID } from "node:crypto";
import { sql } from "./db.ts";
import { computeScheduledTimes } from "./campaign-schedule.ts";
import { buildEmailHtml, LOGO_CID } from "./email-signature.ts";
import { MAX_CONSECUTIVE_SEND_FAILURES, type DraftResult, type OutreachConfig } from "./store.ts";
import { notifySendStarted, notifyAccountPaused } from "./push-notifier.ts";

export type CampaignStatus = "running" | "completed" | "canceled";
export type CampaignEmailStatus = "pending" | "sending" | "sent" | "failed" | "canceled" | "skipped";

export type DeliveryStatus = "delivered" | "bounced" | null;
export type BounceType = "hard" | "soft" | null;

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
  bounceType: BounceType;
  // Filled in by the public app/api/t/o and app/api/t/c routes, hit directly
  // by the recipient's mail client — see lib/tracking.ts.
  openedAt: string | null;
  openCount: number;
  clickedAt: string | null;
  clickCount: number;
  unsubscribedAt: string | null;
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
  senderAccountLabel: string | null;
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
  // When set, this campaign is pinned to one sender account instead of
  // drawing from the whole active pool.
  senderAccountId?: number | null;
}

export interface CreateCampaignResult {
  id: string;
  // Recipients dropped from this run because they'd already unsubscribed or
  // hard-bounced previously (see suppressed_emails) — surfaced so the caller
  // can tell the user why the scheduled count is lower than what they asked
  // for, instead of silently sending to fewer people than expected.
  excludedCount: number;
}

export async function createCampaign({
  drafts,
  config,
  durationHours,
  startAt,
  senderAccountId,
}: CreateCampaignInput): Promise<CreateCampaignResult> {
  const suppressed = await sql`
    SELECT email FROM suppressed_emails WHERE email = ANY(${drafts.map((d) => d.email.toLowerCase())}::text[])
  `;
  const suppressedSet = new Set(suppressed.map((r) => r.email as string));
  const includedDrafts = drafts.filter((d) => !suppressedSet.has(d.email.toLowerCase()));
  if (includedDrafts.length === 0) {
    throw new Error("All recipients are suppressed — nothing to schedule");
  }

  if (senderAccountId !== undefined && senderAccountId !== null) {
    const [senderAccount] = await sql`
      SELECT id, label, status
      FROM sender_accounts
      WHERE id = ${senderAccountId}
    `;
    if (!senderAccount) {
      throw new Error("Selected sender account not found");
    }
    if (senderAccount.status !== "active") {
      throw new Error("Selected sender account is paused");
    }
    // The real gate against double-booking an account — checked here, not
    // just hidden in the UI, so a stale dropdown or a direct API call can't
    // pin two running campaigns to the same mailbox.
    const [lockedBy] = await sql`
      SELECT id FROM campaigns WHERE sender_account_id = ${senderAccountId} AND status = 'running'
    `;
    if (lockedBy) {
      throw new Error("This account is already sending another campaign — pick a different one or wait for it to finish.");
    }
  }

  const now = new Date();
  const requestedStart = startAt ? new Date(startAt) : now;
  const windowStart = requestedStart.getTime() > now.getTime() ? requestedStart : now;
  const windowEnd = new Date(windowStart.getTime() + durationHours * 3600_000);
  const scheduledTimes = computeScheduledTimes(includedDrafts.length, windowStart, windowEnd);

  const [campaign] = await sql`
    INSERT INTO campaigns (window_start, window_end, total_count, sender_account_id)
    VALUES (${windowStart.toISOString()}, ${windowEnd.toISOString()}, ${includedDrafts.length}, ${senderAccountId ?? null})
    RETURNING id
  `;
  const campaignId = campaign.id as string;

  // Row ids are generated here, before insert, rather than left to the
  // column's gen_random_uuid() default — buildEmailHtml() below needs each
  // row's id up front to bake per-recipient tracking/unsubscribe links into
  // the html that actually gets stored and sent.
  const ids = includedDrafts.map(() => randomUUID());

  // The Neon serverless driver is HTTP-based (one round trip per query, no
  // persistent connection) — inserting hundreds of rows one at a time here
  // would mean hundreds of sequential round trips, easily blowing past a
  // Vercel Hobby function's default timeout. unnest() turns it into one.
  const toEmails = includedDrafts.map((d) => d.email);
  const subjects = includedDrafts.map((d) => d.subject);
  const bodies = includedDrafts.map((d) => d.body);
  const htmls = includedDrafts.map((d, i) => buildEmailHtml(config, d.body, `cid:${LOGO_CID}`, ids[i]));
  const scheduledAt = scheduledTimes.map((t) => t.toISOString());

  await sql`
    INSERT INTO campaign_emails (id, campaign_id, to_email, subject, body, html, scheduled_at)
    SELECT id, ${campaignId}, to_email, subject, body, html, scheduled_at FROM unnest(
      ${ids}::uuid[],
      ${toEmails}::text[],
      ${subjects}::text[],
      ${bodies}::text[],
      ${htmls}::text[],
      ${scheduledAt}::timestamptz[]
    ) AS t(id, to_email, subject, body, html, scheduled_at)
  `;

  return { id: campaignId, excludedCount: drafts.length - includedDrafts.length };
}

// Which active accounts are currently pinned to a still-running campaign —
// used by the accounts API to hide/explain unavailable accounts in the Send
// page's picker. Read-only; the actual enforcement gate lives in
// createCampaign() above, since a UI snapshot can go stale between renders.
export async function getAccountsLockedByRunningCampaign(): Promise<Map<number, string>> {
  const rows = await sql`
    SELECT sender_account_id, id FROM campaigns WHERE status = 'running' AND sender_account_id IS NOT NULL
  `;
  return new Map(rows.map((r) => [r.sender_account_id as number, r.id as string]));
}

export async function listCampaigns(limit = 50): Promise<CampaignListItem[]> {
  const rows = await sql`
    SELECT c.id, c.status, c.created_at, c.window_start, c.window_end, c.total_count, c.sent_count, c.failed_count,
      c.skipped_count, sa.label AS sender_account_label
    FROM campaigns c
    LEFT JOIN sender_accounts sa ON sa.id = c.sender_account_id
    ORDER BY c.created_at DESC
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
    senderAccountLabel: (c.sender_account_label as string | null) ?? null,
  }));
}

export async function getCampaign(id: string): Promise<CampaignSummary | null> {
  const [campaign] = await sql`
    SELECT c.id, c.status, c.created_at, c.window_start, c.window_end, c.total_count, c.sent_count, c.failed_count,
      c.skipped_count, c.consecutive_failures, sa.label AS sender_account_label
    FROM campaigns c
    LEFT JOIN sender_accounts sa ON sa.id = c.sender_account_id
    WHERE c.id = ${id}
  `;
  if (!campaign) return null;

  const emails = await sql`
    SELECT ce.id, ce.to_email, ce.status, ce.error, ce.sent_at, ce.scheduled_at, ce.delivery_status, ce.bounce_reason,
      ce.bounce_type, ce.opened_at, ce.open_count, ce.clicked_at, ce.click_count, ce.unsubscribed_at, sa.label AS account_label
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
    senderAccountLabel: (campaign.sender_account_label as string | null) ?? null,
    emails: emails.map((e) => ({
      id: e.id as string,
      email: e.to_email as string,
      status: e.status as CampaignEmailStatus,
      error: (e.error as string | null) ?? null,
      sentAt: (e.sent_at as string | null) ?? null,
      scheduledAt: e.scheduled_at as string,
      deliveryStatus: (e.delivery_status as DeliveryStatus) ?? null,
      bounceReason: (e.bounce_reason as string | null) ?? null,
      bounceType: (e.bounce_type as BounceType) ?? null,
      openedAt: (e.opened_at as string | null) ?? null,
      openCount: (e.open_count as number) ?? 0,
      clickedAt: (e.clicked_at as string | null) ?? null,
      clickCount: (e.click_count as number) ?? 0,
      unsubscribedAt: (e.unsubscribed_at as string | null) ?? null,
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
  senderAccountId: number | null;
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
export async function claimDueEmails(limit: number, healthyAccountIds: number[]): Promise<DueEmail[]> {
  const rows = await sql`
    WITH due AS (
      SELECT ce.id, c.sender_account_id
      FROM campaign_emails ce
      JOIN campaigns c ON c.id = ce.campaign_id
      LEFT JOIN sender_accounts sa ON sa.id = c.sender_account_id
      WHERE c.status = 'running'
        AND ce.scheduled_at <= now()
        AND (
          ce.status = 'pending'
          -- a row stuck in 'sending' means a prior tick claimed it but never
          -- recorded a result (e.g. hit the function timeout) — retry it.
          OR (ce.status = 'sending' AND ce.scheduled_at <= now() - interval '2 minutes')
        )
        AND (
          c.sender_account_id IS NULL
          OR (sa.status = 'active' AND c.sender_account_id = ANY(${healthyAccountIds}::int[]))
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
      campaign_emails.subject, campaign_emails.body, campaign_emails.html, due.sender_account_id
  `;
  return rows.map((r) => ({
    id: r.id as string,
    campaignId: r.campaign_id as string,
    toEmail: r.to_email as string,
    subject: r.subject as string,
    body: r.body as string,
    html: r.html as string,
    senderAccountId: (r.sender_account_id as number | null) ?? null,
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
    const [campaign] = await sql`
      UPDATE campaigns SET sent_count = sent_count + 1, consecutive_failures = 0
      WHERE id = ${campaignId}
      RETURNING sent_count
    `;
    await sql`UPDATE sender_accounts SET consecutive_failures = 0 WHERE id = ${accountId}`;
    // Postgres serializes concurrent updates to the same row, so exactly one
    // caller ever observes sent_count transition to 1 — that's this
    // campaign's first successful send, worth a "sending started" push.
    if (campaign && (campaign.sent_count as number) === 1) {
      await notifySendStarted().catch((err) => console.error("notifySendStarted failed:", err));
    }
  } else {
    await sql`UPDATE campaign_emails SET status = 'failed', error = ${result.error}, account_id = ${accountId} WHERE id = ${id}`;
    await sql`UPDATE campaigns SET failed_count = failed_count + 1, consecutive_failures = consecutive_failures + 1 WHERE id = ${campaignId}`;
    const [account] = await sql`
      UPDATE sender_accounts SET consecutive_failures = consecutive_failures + 1
      WHERE id = ${accountId}
      RETURNING consecutive_failures
    `;
    if (account && shouldPauseAccount(account.consecutive_failures as number)) {
      const [paused] = await sql`
        UPDATE sender_accounts
        SET status = 'paused'
        WHERE id = ${accountId} AND status = 'active'
        RETURNING label, smtp_user
        RETURNING label, smtp_user
      `;
      if (paused) {
        const label = (paused.label as string | null) || (paused.smtp_user as string);
        await notifyAccountPaused(label).catch((err) => console.error("notifyAccountPaused failed:", err));
      }
    }
  }

  const [remaining] = await sql`
    SELECT count(*)::int AS n FROM campaign_emails WHERE campaign_id = ${campaignId} AND status IN ('pending', 'sending')
  `;
  if ((remaining.n as number) === 0) {
    await sql`UPDATE campaigns SET status = 'completed' WHERE id = ${campaignId} AND status = 'running'`;
  }
}
