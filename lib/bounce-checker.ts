import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";
import { sql } from "./db.ts";
import { getDecryptedSmtpPassword, listAccounts, type SenderAccount } from "./sender-accounts.ts";

// Check IMAP every 1 minute when sent emails are pending delivery confirmation
// so bounce-back DSN notifications are detected promptly during active sends.
const CHECK_INTERVAL_MS = 1 * 60_000;
// markInferredDelivered() below waits 24 hours of silence before assuming a
// 'sent' email was actually delivered — SMTP has no positive delivery
// acknowledgement, so this is a heuristic, not a real confirmation, but
// bounces overwhelmingly arrive within minutes to a few hours.

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

// RFC 3463 enhanced status code (x.y.z) or a bare SMTP reply code: a 5.x.x/5xx
// is permanent (bad address, domain gone — safe to suppress for good), a
// 4.x.x/4xx is transient (mailbox full, greylisted — will likely work later).
// No recognizable code at all defaults to 'soft', matching this codebase's
// existing bias elsewhere (lib/smtp-verifier.ts retries once before
// finalizing "invalid") of not permanently suppressing on an ambiguous signal.
export function classifyBounceType(dsnText: string): "hard" | "soft" {
  const enhanced = dsnText.match(/\b([45])\.\d{1,3}\.\d{1,3}\b/);
  if (enhanced) return enhanced[1] === "5" ? "hard" : "soft";
  const bare = dsnText.match(/\b([45])\d{2}\b/);
  if (bare) return bare[1] === "5" ? "hard" : "soft";
  return "soft";
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
  const bounceType = classifyBounceType(dsnText);
  const [updated] = await sql`
    UPDATE campaign_emails
    SET delivery_status = 'bounced', bounce_reason = ${reason}, bounce_type = ${bounceType}, bounce_checked_at = now()
    WHERE id = (
      SELECT id FROM campaign_emails
      WHERE to_email = ${recipient} AND status = 'sent' AND delivery_status IS NULL
      ORDER BY sent_at DESC
      LIMIT 1
    )
    RETURNING id
  `;

  // A hard bounce means the address itself is gone — suppress it for good so
  // no future campaign re-targets it, rather than relying on someone to
  // notice and remove it by hand.
  if (bounceType === "hard" && updated) {
    await sql`
      INSERT INTO suppressed_emails (email, reason) VALUES (${recipient}, 'hard_bounce')
      ON CONFLICT (email) DO NOTHING
    `;
  }
}

async function markInferredDelivered(): Promise<void> {
  await sql`
    UPDATE campaign_emails
    SET delivery_status = 'delivered', bounce_checked_at = now()
    WHERE status = 'sent' AND delivery_status IS NULL AND sent_at < now() - interval '24 hours'
  `;
}

async function pollInbox(account: SenderAccount): Promise<void> {
  const client = new ImapFlow({
    host: deriveImapHost(account.smtpHost),
    port: 993,
    secure: true,
    auth: { user: account.smtpUser, pass: getDecryptedSmtpPassword(account) },
    logger: false,
  });

  await client.connect();
  try {
    const lock = await client.getMailboxLock("INBOX");
    try {
      const mailbox = client.mailbox;
      if (!mailbox) return;
      const uidValidity = Number(mailbox.uidValidity);

      let lastUid = account.bounceLastUid;
      const knownUidValidity = account.bounceUidvalidity;

      // On initial setup or UIDVALIDITY reset, start checking from recent messages
      // (last 20) instead of skipping existing messages entirely.
      if (!account.lastBounceCheckAt || knownUidValidity !== uidValidity) {
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
        UPDATE sender_accounts
        SET bounce_last_uid = ${maxSeenUid}, bounce_uidvalidity = ${uidValidity}, last_bounce_check_at = now()
        WHERE id = ${account.id}
      `;
    } finally {
      lock.release();
    }
  } finally {
    await client.logout().catch(() => {});
  }
}

async function checkBouncesForAccount(account: SenderAccount): Promise<void> {
  try {
    if (account.lastBounceCheckAt && Date.now() - new Date(account.lastBounceCheckAt).getTime() < CHECK_INTERVAL_MS) return;

    const [{ n: pendingConfirmation }] = await sql`
      SELECT count(*)::int AS n FROM campaign_emails WHERE status = 'sent' AND delivery_status IS NULL AND account_id = ${account.id}
    `;
    // Nothing to confirm and the UID baseline is already established for
    // this account — skip the IMAP round trip entirely. The baseline
    // pointer only moves forward while actually polling, so once this
    // account sends something new, the next check just scans a slightly
    // bigger (still cheap) backlog rather than losing track of anything.
    if ((pendingConfirmation as number) === 0 && account.lastBounceCheckAt) return;

    await pollInbox(account);
  } catch (err) {
    // Best-effort — IMAP misconfiguration on one account must never take
    // down bounce checking for the others, or the send cron itself.
    console.error(`IMAP bounce check failed for account ${account.id}:`, err instanceof Error ? err.message : err);
  }
}

// Polls every account's sending mailbox over IMAP for bounce-back (DSN)
// notifications and reconciles them against 'sent' campaign_emails rows —
// SMTP accepting a message (all `status = 'sent'` means) isn't the same as
// the recipient's server actually keeping it. Bounces show up later,
// asynchronously, as a separate email in that same inbox. Fully best-effort:
// a failure on any one account must never break the send cron tick that
// calls this alongside the real send work, nor delay the other accounts.
export async function checkBounces(): Promise<void> {
  try {
    const accounts = await listAccounts();
    await Promise.allSettled(accounts.map(checkBouncesForAccount));
  } finally {
    await markInferredDelivered().catch(() => {});
  }
}
