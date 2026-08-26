import nodemailer from "nodemailer";
import path from "node:path";
import { LOGO_CID } from "./email-signature";
import { ELEVIQUE_OUTREACH_CONFIG } from "./store";

export interface SendMailInput {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

let transporter: nodemailer.Transporter | null = null;

function getTransporter(): nodemailer.Transporter {
  const user = process.env.EMAIL_USER?.trim();
  const pass = process.env.EMAIL_PASSWORD?.trim();
  if (!user || !pass) {
    throw new Error("EMAIL_USER / EMAIL_PASSWORD not set in environment (server restart required after adding)");
  }
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: process.env.EMAIL_HOST || "smtp.hostinger.com",
      port: Number(process.env.EMAIL_PORT) || 465,
      secure: true, // port 465 = SSL
      auth: { user, pass },
    });
  }
  return transporter;
}

// Shared by the immediate-send route and the background campaign cron
// worker so SMTP/transport behavior only lives in one place.
export async function sendMailDirect({ to, subject, text, html }: SendMailInput): Promise<void> {
  const user = process.env.EMAIL_USER?.trim();
  const t = getTransporter();

  await t.sendMail({
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
