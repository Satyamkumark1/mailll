import nodemailer from "nodemailer";
import path from "node:path";
import { LOGO_CID } from "@/lib/email-signature";
import { ELEVIQUE_OUTREACH_CONFIG } from "@/lib/store";

export async function POST(request: Request) {
  const { to, subject, body, html } = await request.json();
  if (!to || !subject || !body) {
    return Response.json({ error: "Missing to/subject/body" }, { status: 400 });
  }

  const user = process.env.EMAIL_USER?.trim();
  const pass = process.env.EMAIL_PASSWORD?.trim();
  if (!user || !pass) {
    return Response.json(
      { error: "EMAIL_USER / EMAIL_PASSWORD not set in .env.local (server restart required after adding)" },
      { status: 500 }
    );
  }

  const transporter = nodemailer.createTransport({
    host: process.env.EMAIL_HOST || "smtp.hostinger.com",
    port: Number(process.env.EMAIL_PORT) || 465,
    secure: true, // port 465 = SSL
    auth: { user, pass },
  });

  try {
    await transporter.sendMail({
      from: `"${ELEVIQUE_OUTREACH_CONFIG.senderName}" <${user}>`,
      to,
      subject,
      text: body,
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
    return Response.json({ success: true });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "Send failed" },
      { status: 502 }
    );
  }
}
