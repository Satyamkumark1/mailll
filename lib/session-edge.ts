export interface SessionPayload {
  userId: string;
  email: string;
  expiresAt: number;
}

export const AUTH_COOKIE_NAME = "auth_session";
export const SESSION_DURATION_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

export function getAuthSecret(): string {
  const secret = process.env.AUTH_SECRET || process.env.SETTINGS_ENCRYPTION_KEY;
  if (!secret) {
    throw new Error(
      "AUTH_SECRET (or SETTINGS_ENCRYPTION_KEY) is not set — session tokens cannot be signed without it."
    );
  }
  return secret;
}

function base64UrlEncode(buffer: Uint8Array): string {
  let str = "";
  for (let i = 0; i < buffer.length; i++) {
    str += String.fromCharCode(buffer[i]);
  }
  return btoa(str).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlDecode(str: string): Uint8Array {
  let base64 = str.replace(/-/g, "+").replace(/_/g, "/");
  const pad = base64.length % 4;
  if (pad) {
    base64 += "=".repeat(4 - pad);
  }
  const raw = atob(base64);
  const buffer = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) {
    buffer[i] = raw.charCodeAt(i);
  }
  return buffer;
}

async function getHmacKey(secret: string): Promise<CryptoKey> {
  const enc = new TextEncoder();
  return await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"]
  );
}

/**
 * Creates an Edge-compatible HMAC-SHA256 signed session token using Web Crypto API.
 */
export async function createSessionTokenEdge(
  userId: string,
  email: string,
  secret: string = getAuthSecret()
): Promise<string> {
  const expiresAt = Date.now() + SESSION_DURATION_MS;
  const payload: SessionPayload = { userId, email, expiresAt };
  const payloadJson = JSON.stringify(payload);
  const payloadBase64 = base64UrlEncode(new TextEncoder().encode(payloadJson));

  const key = await getHmacKey(secret);
  const sigBuffer = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(payloadBase64)
  );
  const sigBase64 = base64UrlEncode(new Uint8Array(sigBuffer));

  return `${payloadBase64}.${sigBase64}`;
}

/**
 * Verifies an Edge-compatible HMAC-SHA256 session token using Web Crypto API.
 */
export async function verifySessionTokenEdge(
  token: string | null | undefined,
  secret: string = getAuthSecret()
): Promise<SessionPayload | null> {
  if (!token) return null;
  const parts = token.split(".");
  if (parts.length !== 2) return null;

  const [payloadBase64, sigBase64] = parts;
  if (!payloadBase64 || !sigBase64) return null;

  try {
    const key = await getHmacKey(secret);
    const sigBytes = base64UrlDecode(sigBase64);
    const isValid = await crypto.subtle.verify(
      "HMAC",
      key,
      sigBytes as unknown as BufferSource,
      new TextEncoder().encode(payloadBase64)
    );

    if (!isValid) return null;

    const payloadBytes = base64UrlDecode(payloadBase64);
    const payloadJson = new TextDecoder().decode(payloadBytes);
    const payload = JSON.parse(payloadJson) as SessionPayload;

    if (!payload.expiresAt || payload.expiresAt < Date.now()) {
      return null;
    }

    return payload;
  } catch {
    return null;
  }
}
