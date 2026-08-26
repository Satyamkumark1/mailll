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

// Shared by the immediate-send route and the background campaign cron
// worker so SMTP/transport behavior only lives in one place.
export async function sendMailDirect({ to, subject, text, html }: SendMailInput): Promise<void> {
  const { transporter, user } = await getTransporter();

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
}
