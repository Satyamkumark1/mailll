import nodemailer from "nodemailer";
import path from "node:path";
import { LOGO_CID } from "./email-signature.ts";
import { getDecryptedSmtpPassword, type SenderAccount } from "./sender-accounts.ts";
import { ELEVIQUE_OUTREACH_CONFIG } from "./store.ts";
import { trackingUnsubscribeUrl } from "./tracking.ts";

export interface SendMailInput {
  to: string;
  subject: string;
  text: string;
  html?: string;
  // The campaign_emails row this send corresponds to — used to build a
  // working List-Unsubscribe link (see lib/tracking.ts).
  emailId: string;
}

// No caching: an account's credentials can change at runtime via Settings,
// and building a nodemailer transporter is a cheap local operation — the
// real cost is the SMTP round trip inside sendMailDirect below. Building N
// of these concurrently for N accounts is equally cheap.
function getTransporter(account: SenderAccount): nodemailer.Transporter {
  return nodemailer.createTransport({
    host: account.smtpHost,
    port: account.smtpPort,
    secure: true, // port 465 = SSL
    auth: { user: account.smtpUser, pass: getDecryptedSmtpPassword(account) },
  });
}

// nodemailer attaches these to thrown Errors at runtime (SMTP rejection
// code/text, the command that failed, or a connection-level code like
// EAUTH/ECONNECTION) but doesn't type them — see smtp-connection/index.js.
interface SmtpError extends Error {
  code?: string;
  responseCode?: number;
  response?: string;
  command?: string;
}

// Turns a raw nodemailer error into the specific reason a mailbox rejected
// the message (SMTP code + server response + which command it happened on),
// instead of nodemailer's often-generic top-level message.
function describeSendError(err: unknown): string {
  if (!(err instanceof Error)) return "Send failed";
  const e = err as SmtpError;
  const parts = [e.message];
  if (e.responseCode) parts.push(`SMTP ${e.responseCode}`);
  if (e.response && e.response !== e.message) parts.push(e.response);
  if (e.command) parts.push(`during ${e.command}`);
  if (e.code && !e.responseCode) parts.push(`[${e.code}]`);
  return parts.join(" — ");
}

// Shared by the background campaign cron worker so SMTP/transport behavior
// only lives in one place. Every account sends under the same brand display
// name (uniform sender identity across the account pool) — only the address
// varies, via `account`.
export async function sendMailDirect(account: SenderAccount, { to, subject, text, html, emailId }: SendMailInput): Promise<void> {
  const transporter = getTransporter(account);

  try {
    await transporter.sendMail({
      from: `"${ELEVIQUE_OUTREACH_CONFIG.senderName}" <${account.smtpUser}>`,
      to,
      subject,
      text,
      // List-Unsubscribe-Post is what makes Gmail/Outlook show their native
      // one-click "Unsubscribe" affordance next to the sender name (RFC
      // 8058), rather than relying on the recipient finding the link buried
      // in the body.
      headers: {
        "List-Unsubscribe": `<mailto:${ELEVIQUE_OUTREACH_CONFIG.contactEmail}?subject=unsubscribe>, <${trackingUnsubscribeUrl(emailId)}>`,
        "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
      },
      ...(html
        ? {
            html,
            attachments: [
              {
                filename: "elevique-logo.png",
                path: path.join(process.cwd(), "public", "elevique-logo.png"),
                cid: LOGO_CID,
              },
            ],
          }
        : {}),
    });
  } catch (err) {
    throw new Error(describeSendError(err));
  }
}
