import nodemailer from "nodemailer";
import path from "node:path";
import { LOGO_CID } from "./email-signature.ts";
import { getDecryptedSmtpPassword, getSenderSettings } from "./sender-settings.ts";
import { ELEVIQUE_OUTREACH_CONFIG } from "./store.ts";

export interface SendMailInput {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

// No module-level cache: sender settings can change at runtime via the
// Settings UI, and building a nodemailer transporter is a cheap local
// operation — the real cost is the SMTP round trip inside sendMail below,
// so there's no benefit to caching across requests here.
async function getTransporter(): Promise<{ transporter: nodemailer.Transporter; user: string }> {
  const settings = await getSenderSettings();
  if (!settings) {
    throw new Error("No sender account configured yet — set one up in Settings.");
  }
  const transporter = nodemailer.createTransport({
    host: settings.smtpHost,
    port: settings.smtpPort,
    secure: true, // port 465 = SSL
    auth: { user: settings.smtpUser, pass: getDecryptedSmtpPassword(settings) },
  });
  return { transporter, user: settings.smtpUser };
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

// Shared by the immediate-send route and the background campaign cron
// worker so SMTP/transport behavior only lives in one place.
export async function sendMailDirect({ to, subject, text, html }: SendMailInput): Promise<void> {
  const { transporter, user } = await getTransporter();

  try {
    await transporter.sendMail({
      from: `"${ELEVIQUE_OUTREACH_CONFIG.senderName}" <${user}>`,
      to,
      subject,
      text,
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
