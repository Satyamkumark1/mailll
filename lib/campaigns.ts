import { sql } from "./db.ts";
import { computeScheduledTimes } from "./campaign-schedule.ts";
import { buildEmailHtml, LOGO_CID } from "./email-signature.ts";
import type { DraftResult, OutreachConfig } from "./store";

export type CampaignStatus = "running" | "completed" | "canceled";
export type CampaignEmailStatus = "pending" | "sending" | "sent" | "failed" | "canceled";

export interface CampaignEmailSummary {
  email: string;
  status: CampaignEmailStatus;
  error: string | null;
  sentAt: string | null;
}

export interface CampaignSummary {
  id: string;
  status: CampaignStatus;
  createdAt: string;
  windowStart: string;
  windowEnd: string;
  totalCount: number;
  sentCount: number;
  failedCount: number;
  emails: CampaignEmailSummary[];
}

export interface CreateCampaignInput {
  drafts: DraftResult[];
  config: OutreachConfig;
  durationHours: number;
}

export async function createCampaign({ drafts, config, durationHours }: CreateCampaignInput): Promise<string> {
  const windowStart = new Date();
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

export async function getCampaign(id: string): Promise<CampaignSummary | null> {
  const [campaign] = await sql`SELECT * FROM campaigns WHERE id = ${id}`;
  if (!campaign) return null;

  const emails = await sql`
    SELECT to_email, status, error, sent_at
    FROM campaign_emails
    WHERE campaign_id = ${id}
    ORDER BY scheduled_at ASC
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
    emails: emails.map((e) => ({
      email: e.to_email as string,
      status: e.status as CampaignEmailStatus,
      error: (e.error as string | null) ?? null,
      sentAt: (e.sent_at as string | null) ?? null,
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

export interface DueEmail {
  id: string;
  campaignId: string;
  toEmail: string;
  subject: string;
  body: string;
  html: string;
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

export async function recordEmailResult(
  id: string,
  campaignId: string,
  result: { status: "sent"; } | { status: "failed"; error: string }
): Promise<void> {
  if (result.status === "sent") {
    await sql`UPDATE campaign_emails SET status = 'sent', sent_at = now() WHERE id = ${id}`;
    await sql`UPDATE campaigns SET sent_count = sent_count + 1 WHERE id = ${campaignId}`;
  } else {
    await sql`UPDATE campaign_emails SET status = 'failed', error = ${result.error} WHERE id = ${id}`;
    await sql`UPDATE campaigns SET failed_count = failed_count + 1 WHERE id = ${campaignId}`;
  }

  const [remaining] = await sql`
    SELECT count(*)::int AS n FROM campaign_emails WHERE campaign_id = ${campaignId} AND status IN ('pending', 'sending')
  `;
  if ((remaining.n as number) === 0) {
    await sql`UPDATE campaigns SET status = 'completed' WHERE id = ${campaignId} AND status = 'running'`;
  }
}
