import type { OutreachConfig } from "./store";

export const LOGO_CID = "elevique-logo";

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function textToHtmlParagraphs(text: string): string {
  return text
    .split(/\n{2,}/)
    .map((para) => `<p style="margin:0 0 16px 0;">${escapeHtml(para).replace(/\n/g, "<br>")}</p>`)
    .join("\n");
}

export function buildSignatureHtml(config: OutreachConfig, logoSrc: string): string {
  return `
<table role="presentation" cellpadding="0" cellspacing="0" style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#1a1a1a;width:100%;max-width:520px;">
  <tr>
    <td style="vertical-align:top;padding:0;">
      <p style="margin:0 0 10px 0;">Regards,</p>
      <p style="margin:0;font-weight:bold;font-size:15px;color:#111111;">${escapeHtml(config.senderName)}</p>
      <p style="margin:2px 0 0 0;color:#555555;font-size:13px;">${escapeHtml(config.title)}</p>
    </td>
    <td style="vertical-align:top;text-align:right;padding:0;">
      <p style="margin:0 0 4px 0;"><strong>Mobile:</strong> ${escapeHtml(config.mobile)}</p>
      <p style="margin:0 0 4px 0;"><strong>Email:</strong> <a href="mailto:${escapeHtml(config.contactEmail)}" style="color:#0d9488;text-decoration:none;">${escapeHtml(config.contactEmail)}</a></p>
      <p style="margin:0;"><strong>Website:</strong> ${escapeHtml(config.website)}</p>
    </td>
  </tr>
</table>
<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;max-width:520px;">
  <tr><td style="border-top:2px solid #14b8a6;font-size:1px;line-height:1px;padding:12px 0 0 0;">&nbsp;</td></tr>
</table>
<img src="${logoSrc}" alt="${escapeHtml(config.company)}" height="26" style="display:block;border:0;height:26px;width:auto;margin-top:14px;">`.trim();
}

export function buildEmailHtml(config: OutreachConfig, messageBody: string, logoSrc: string): string {
  const signature = config.signature.trim();
  const trimmedBody = messageBody.trimEnd();
  const messageWithoutSignature = trimmedBody.endsWith(signature)
    ? trimmedBody.slice(0, trimmedBody.length - signature.length).trimEnd()
    : trimmedBody;

  return `
<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.6;color:#1a1a1a;max-width:560px;">
${textToHtmlParagraphs(messageWithoutSignature)}
<div style="margin-top:48px;">
${buildSignatureHtml(config, logoSrc)}
</div>
</div>`.trim();
}
