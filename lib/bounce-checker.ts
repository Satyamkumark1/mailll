import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";
import { sql } from "./db.ts";
import { getDecryptedSmtpPassword, getSenderSettings, type SenderSettings } from "./sender-settings.ts";

// Check IMAP every 1 minute when sent emails are pending delivery confirmation
// so bounce-back DSN notifications are detected promptly during active sends.
const CHECK_INTERVAL_MS = 1 * 60_000;
// How long to wait with no bounce before inferring a 'sent' email was
// actually delivered. SMTP has no positive delivery acknowledgement — this
// is a heuristic, not a real confirmation, but bounces overwhelmingly arrive
// within minutes to a few hours, so 24h with silence is a safe read.
const DELIVERED_AFTER_MS = 24 * 3600_000;

const BOUNCE_SUBJECT_RE =
  /undeliver|delivery status notification|delivery has failed|mail delivery failed|returned mail|failure notice|delivery incomplete|delivery failure/i;

// Zoho (and most providers) serve IMAP off "imap." where SMTP is "smtp." on
// the same base domain, using the same account credentials. Good enough for
// the Zoho-centric guidance already baked into this app (see CLAUDE.md); a
// provider that doesn't follow this convention just won't get bounce
// tracking, same as if IMAP were unreachable for any other reason.
function deriveImapHost(smtpHost: string): string {
  return smtpHost.startsWith("smtp.") ? smtpHost.replace(/^smtp\./, "imap.") : smtpHost;
}

function extractFinalRecipient(dsnText: string): string | null {
  const match = dsnText.match(/Final-Recipient:\s*(?:rfc822;)?\s*<?([^\s>]+)>?/i);
  return match ? match[1].toLowerCase().trim() : null;
}

function extractDiagnostic(dsnText: string): string | null {
  const match = dsnText.match(/Diagnostic-Code:\s*(.+)/i) || dsnText.match(/Status:\s*(.+)/i);
  return match ? match[1].trim().slice(0, 300) : null;
}

function isContentTypeDeliveryReport(headers: Map<string, unknown>): boolean {
  const contentType = headers.get("content-type") as { value?: string; params?: Record<string, string> } | undefined;
  return contentType?.value === "multipart/report" && contentType.params?.["report-type"] === "delivery-status";
}

// Reconciles one fetched message against 'sent' campaign_emails rows if it
// looks like a bounce-back (DSN). Best-effort per message: a message this
// can't parse as a bounce is just left alone, never treated as an error.
async function processMessage(source: Buffer): Promise<void> {
  const parsed = await simpleParser(source, { keepDeliveryStatus: true });
  const subject = parsed.subject || "";
  if (!isContentTypeDeliveryReport(parsed.headers) && !BOUNCE_SUBJECT_RE.test(subject)) return;

  const dsnAttachment = parsed.attachments.find((a) => a.contentType === "message/delivery-status");
  const dsnText = dsnAttachment ? dsnAttachment.content.toString("utf-8") : parsed.text || "";

  const recipient = extractFinalRecipient(dsnText);
  if (!recipient) return;

  const reason = extractDiagnostic(dsnText) ?? subject.slice(0, 300) ?? null;
  await sql`
    UPDATE campaign_emails
    SET delivery_status = 'bounced', bounce_reason = ${reason}, bounce_checked_at = now()
    WHERE id = (
      SELECT id FROM campaign_emails
      WHERE to_email = ${recipient} AND status = 'sent' AND delivery_status IS NULL
      ORDER BY sent_at DESC
      LIMIT 1
    )
  `;
}

async function markInferredDelivered(): Promise<void> {
  await sql`
    UPDATE campaign_emails
    SET delivery_status = 'delivered', bounce_checked_at = now()
    WHERE status = 'sent' AND delivery_status IS NULL AND sent_at < now() - interval '24 hours'
  `;
}

async function pollInbox(settings: SenderSettings, lastCheckedAt: string | null, lastUidRaw: unknown, uidValidityRaw: unknown): Promise<void> {
  const client = new ImapFlow({
    host: deriveImapHost(settings.smtpHost),
    port: 993,
    secure: true,
    auth: { user: settings.smtpUser, pass: getDecryptedSmtpPassword(settings) },
    logger: false,
  });

  await client.connect();
  try {
    const lock = await client.getMailboxLock("INBOX");
    try {
      const mailbox = client.mailbox;
      if (!mailbox) return;
      const uidValidity = Number(mailbox.uidValidity);

      let lastUid = Number(lastUidRaw ?? 0);
      const knownUidValidity = Number(uidValidityRaw ?? 0);

      // On initial setup or UIDVALIDITY reset, start checking from recent messages
      // (last 20) instead of skipping existing messages entirely.
      if (!lastCheckedAt || knownUidValidity !== uidValidity) {
        lastUid = Math.max(0, mailbox.uidNext - 20);
      }

      let maxSeenUid = lastUid;
      if (lastUid + 1 < mailbox.uidNext) {
        for await (const message of client.fetch(`${lastUid + 1}:*`, { source: true }, { uid: true })) {
          // A "N:*" range can include the last-known UID itself when nothing
          // newer exists yet — skip anything not actually past our mark.
          if (message.uid <= lastUid) continue;
          maxSeenUid = Math.max(maxSeenUid, message.uid);
          if (!message.source) continue;
          await processMessage(message.source);
        }
      }

      await sql`
        UPDATE sender_settings
        SET bounce_last_uid = ${maxSeenUid}, bounce_uidvalidity = ${uidValidity}, last_bounce_check_at = now()
        WHERE id = 1
      `;
    } finally {
      lock.release();
    }
  } finally {
    await client.logout().catch(() => {});
  }
}

// Polls the sending mailbox over IMAP for bounce-back (DSN) notifications and
// reconciles them against 'sent' campaign_emails rows — SMTP accepting a
// message (all `status = 'sent'` means) isn't the same as the recipient's
// server actually keeping it. Bounces show up later, asynchronously, as a
// separate email in this same inbox. Throttled and fully best-effort: any
// failure here (bad/missing IMAP access, network, parsing) must never break
// the send cron tick that calls this alongside the real send work.
export async function checkBounces(): Promise<void> {
  try {
    const settings = await getSenderSettings();
    if (!settings) return;

    const [state] = await sql`
      SELECT last_bounce_check_at, bounce_last_uid, bounce_uidvalidity FROM sender_settings WHERE id = 1
    `;
    const lastCheckedAt = (state?.last_bounce_check_at as string | null) ?? null;
    if (lastCheckedAt && Date.now() - new Date(lastCheckedAt).getTime() < CHECK_INTERVAL_MS) return;

    const [{ n: pendingConfirmation }] = await sql`
      SELECT count(*)::int AS n FROM campaign_emails WHERE status = 'sent' AND delivery_status IS NULL
    `;
    // Nothing to confirm and the UID baseline is already established — skip
    // the IMAP round trip entirely. The baseline pointer only moves forward
    // while we're actually polling, so once a new campaign does send
    // something, the next check just scans a slightly bigger (still cheap)
    // backlog rather than losing track of anything.
    if ((pendingConfirmation as number) === 0 && lastCheckedAt) return;

    await pollInbox(settings, lastCheckedAt, state?.bounce_last_uid, state?.bounce_uidvalidity);
  } catch {
    // Best-effort — IMAP misconfiguration must never take down the send cron.
  } finally {
    await markInferredDelivered().catch(() => {});
  }
}
