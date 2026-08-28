import crypto from "node:crypto";
import { sql } from "./db.ts";
import {
  createSessionTokenEdge,
  verifySessionTokenEdge,
  AUTH_COOKIE_NAME,
  SESSION_DURATION_MS,
  type SessionPayload,
} from "./session-edge.ts";

export interface UserRow {
  id: string;
  email: string;
  password_hash: string;
  created_at: string;
  updated_at: string;
}

export { AUTH_COOKIE_NAME, SESSION_DURATION_MS, type SessionPayload };

/**
 * Hashes a plaintext password using PBKDF2 with a random salt.
 */
export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString("hex");
  const iterations = 100000;
  const hash = crypto.pbkdf2Sync(password, salt, iterations, 64, "sha512").toString("hex");
  return `${salt}:${iterations}:${hash}`;
}

/**
 * Verifies a plaintext password against a stored `salt:iterations:hash` string.
 */
export function verifyPassword(password: string, storedHash: string): boolean {
  try {
    const parts = storedHash.split(":");
    if (parts.length !== 3) return false;
    const [salt, iterationsStr, originalHash] = parts;
    const iterations = parseInt(iterationsStr, 10);
    if (!salt || !iterations || !originalHash) return false;

    const hash = crypto.pbkdf2Sync(password, salt, iterations, 64, "sha512").toString("hex");
    return crypto.timingSafeEqual(Buffer.from(hash, "hex"), Buffer.from(originalHash, "hex"));
  } catch {
    return false;
  }
}

/**
 * Creates an HMAC-signed session token for a given user.
 */
export async function createSessionToken(userId: string, email: string): Promise<string> {
  return createSessionTokenEdge(userId, email);
}

/**
 * Verifies and decodes an HMAC-signed session token.
 * Returns the SessionPayload if valid and unexpired, otherwise null.
 */
export async function verifySessionToken(token: string | null | undefined): Promise<SessionPayload | null> {
  return verifySessionTokenEdge(token);
}

/**
 * Creates the users table if it does not already exist.
 */
export async function ensureUsersTable(): Promise<void> {
  await sql`
    CREATE TABLE IF NOT EXISTS users (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `;
}

/**
 * Finds a user in Neon Postgres by email address.
 */
export async function findUserByEmail(email: string): Promise<UserRow | null> {
  await ensureUsersTable();
  const normalizedEmail = email.trim().toLowerCase();
  const rows = await sql`
    SELECT id, email, password_hash, created_at, updated_at
    FROM users
    WHERE LOWER(email) = ${normalizedEmail}
    LIMIT 1;
  `;
  if (rows.length === 0) return null;
  return rows[0] as unknown as UserRow;
}

/**
 * Seeds or updates an authorized user in Neon Postgres.
 */
export async function seedOrUpdateUser(email: string, plainPassword: string): Promise<UserRow> {
  await ensureUsersTable();
  const normalizedEmail = email.trim().toLowerCase();
  const passwordHash = hashPassword(plainPassword);

  const existing = await findUserByEmail(normalizedEmail);
  if (existing) {
    const updated = await sql`
      UPDATE users
      SET password_hash = ${passwordHash}, updated_at = now()
      WHERE id = ${existing.id}
      RETURNING id, email, password_hash, created_at, updated_at;
    `;
    return updated[0] as unknown as UserRow;
  }

  const inserted = await sql`
    INSERT INTO users (email, password_hash)
    VALUES (${normalizedEmail}, ${passwordHash})
    RETURNING id, email, password_hash, created_at, updated_at;
  `;
  return inserted[0] as unknown as UserRow;
}
