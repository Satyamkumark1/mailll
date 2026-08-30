import crypto from "node:crypto";

// Server-only URL builders for the public tracking/unsubscribe routes
// (app/api/t/*). Pure — no DB access — so these can be called from anywhere
// building outgoing email content (lib/campaigns.ts, lib/email-signature.ts,
// lib/send-mail.ts) without pulling in a Postgres dependency.

function getAppBaseUrl(): string {
  if (process.env.APP_BASE_URL) return process.env.APP_BASE_URL;
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  return "http://localhost:3000";
}

function getTrackingSecret(): string {
  const secret = process.env.AUTH_SECRET || process.env.SETTINGS_ENCRYPTION_KEY;
  if (!secret) {
    throw new Error("AUTH_SECRET (or SETTINGS_ENCRYPTION_KEY) is not set — tracking links cannot be signed without it.");
  }
  return secret;
}

function signTrackingClickTarget(emailId: string, targetUrl: string, secret: string = getTrackingSecret()): string {
  return crypto.createHmac("sha256", secret).update(`${emailId}\0${targetUrl}`).digest("base64url");
}

export function trackingPixelUrl(emailId: string): string {
  return `${getAppBaseUrl()}/api/t/o/${emailId}`;
}

export function trackingClickUrl(emailId: string, targetUrl: string): string {
  return `${getAppBaseUrl()}/api/t/c/${emailId}?u=${encodeURIComponent(targetUrl)}&s=${signTrackingClickTarget(emailId, targetUrl)}`;
}

export function verifyTrackingClickTarget(emailId: string, targetUrl: string, signature: string | null): boolean {
  if (!signature) return false;
  try {
    const expected = signTrackingClickTarget(emailId, targetUrl);
    const expectedBytes = Buffer.from(expected, "utf8");
    const signatureBytes = Buffer.from(signature, "utf8");
    if (expectedBytes.length !== signatureBytes.length) return false;
    return crypto.timingSafeEqual(expectedBytes, signatureBytes);
  } catch {
    return false;
  }
}

export function trackingUnsubscribeUrl(emailId: string): string {
  return `${getAppBaseUrl()}/api/t/u/${emailId}`;
}
