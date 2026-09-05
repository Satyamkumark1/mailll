import { sql } from "./db.ts";
import { decryptSecret, encryptSecret } from "./secret-crypto.ts";
import { computeWarmupCap, DEFAULT_RAMP_DAYS } from "./warmup.ts";
import { logActivity } from "./activity-log.ts";

// Zoho's own documented ceiling for external sending, regardless of
// reputation — see https://www.zoho.com/mail/help/adminconsole/rates-and-limits.html.
export const ZOHO_HARD_HOURLY_CEILING = 500;
// The low end of Zoho's reputation-based dynamic range — going above this
// without an established sending history is what risks a repeat block.
export const ZOHO_REPUTATION_HOURLY_FLOOR = 50;

const WARMUP_HOURLY_FLOOR = 10;
const WARMUP_DAILY_FLOOR = 40;

export type AccountStatus = "active" | "paused";

export interface SenderAccount {
  id: number;
  label: string;
  status: AccountStatus;
  smtpHost: string;
  smtpPort: number;
  smtpUser: string;
  smtpPasswordEncrypted: string;
  hourlyCap: number;
  dailyCap: number;
  warmupEnabled: boolean;
  warmupStartDate: string;
  consecutiveFailures: number;
  lastBounceCheckAt: string | null;
  bounceLastUid: number;
  bounceUidvalidity: number;
}

export interface SaveAccountInput {
  label?: string;
  smtpHost: string;
  smtpPort: number;
  smtpUser: string;
  smtpPassword?: string; // blank/undefined on update = keep existing; required on create
  hourlyCap: number;
  dailyCap: number;
  warmupEnabled: boolean;
}

export interface SaveAccountResult {
  id: number;
  warning: string | null;
}

function fromRow(row: Record<string, unknown>): SenderAccount {
  return {
    id: row.id as number,
    label: (row.label as string) || (row.smtp_user as string),
    status: row.status as AccountStatus,
    smtpHost: row.smtp_host as string,
    smtpPort: row.smtp_port as number,
    smtpUser: row.smtp_user as string,
    smtpPasswordEncrypted: row.smtp_password_encrypted as string,
    hourlyCap: row.hourly_cap as number,
    dailyCap: row.daily_cap as number,
    warmupEnabled: row.warmup_enabled as boolean,
    warmupStartDate: row.warmup_start_date as string,
    consecutiveFailures: row.consecutive_failures as number,
    lastBounceCheckAt: (row.last_bounce_check_at as string | null) ?? null,
    bounceLastUid: Number(row.bounce_last_uid ?? 0),
    bounceUidvalidity: Number(row.bounce_uidvalidity ?? 0),
  };
}

function seedFromEnv(): SaveAccountInput | null {
  const user = process.env.EMAIL_USER?.trim();
  const pass = process.env.EMAIL_PASSWORD?.trim();
  if (!user || !pass) return null;
  return {
    label: user,
    smtpHost: process.env.EMAIL_HOST || "smtp.hostinger.com",
    smtpPort: Number(process.env.EMAIL_PORT) || 465,
    smtpUser: user,
    smtpPassword: pass,
    hourlyCap: Number(process.env.EMAIL_HOURLY_CAP) || 35,
    dailyCap: Number(process.env.EMAIL_DAILY_CAP) || 150,
    warmupEnabled: true,
  };
}

function isUniqueViolation(err: unknown): boolean {
  return typeof err === "object" && err !== null && "code" in err && (err as { code?: string }).code === "23505";
}

// createAccount()/updateAccount() below catch the raw Postgres unique
// violation and re-throw a friendlier Error — which loses the original
// `.code`. Tag the replacement so listAccounts() can still tell "this failed
// because someone else concurrently created the same account" apart from
// any other failure, without string-matching the message.
const ACCOUNT_CONFLICT_CODE = "ACCOUNT_CONFLICT";
function isAccountConflictError(err: unknown): boolean {
  return typeof err === "object" && err !== null && (err as { code?: string }).code === ACCOUNT_CONFLICT_CODE;
}
function accountConflictError(smtpUser: string): Error {
  return Object.assign(new Error(`An account for ${smtpUser} is already configured.`), { code: ACCOUNT_CONFLICT_CODE });
}

function validateInput(input: SaveAccountInput) {
  if (!input.smtpHost.trim() || !input.smtpUser.trim()) {
    throw new Error("SMTP host and user are required");
  }
  if (!Number.isFinite(input.smtpPort) || input.smtpPort <= 0) {
    throw new Error("SMTP port must be a positive number");
  }
  if (!Number.isInteger(input.hourlyCap) || input.hourlyCap <= 0) {
    throw new Error("Hourly cap must be a positive integer");
  }
  if (input.hourlyCap > ZOHO_HARD_HOURLY_CEILING) {
    throw new Error(
      `Hourly cap of ${input.hourlyCap} exceeds Zoho's documented absolute ceiling of ${ZOHO_HARD_HOURLY_CEILING}/hr — pick a lower value.`
    );
  }
  if (!Number.isInteger(input.dailyCap) || input.dailyCap < input.hourlyCap) {
    throw new Error("Daily cap must be a positive integer at least as large as the hourly cap");
  }
}

function warningFor(input: SaveAccountInput): string | null {
  return input.hourlyCap > ZOHO_REPUTATION_HOURLY_FLOOR
    ? `${input.hourlyCap}/hr is above the ${ZOHO_REPUTATION_HOURLY_FLOOR}/hr low end of Zoho's reputation-based range — safe for an established, high-reputation account, but risks another block on one that isn't.`
    : null;
}

// Reads every configured account; if none exist yet, seeds one from the
// legacy EMAIL_* env vars (so an already-working single account carries
// over with no manual re-entry) and persists that seed so future reads are
// stable.
export async function listAccounts(): Promise<SenderAccount[]> {
  const rows = await sql`SELECT * FROM sender_accounts ORDER BY id`;
  if (rows.length > 0) return rows.map(fromRow);

  const seed = seedFromEnv();
  if (!seed) return [];

  try {
    const created = await createAccount(seed);
    // Only this branch actually created the row — the catch below can also
    // land here on a conflict from a concurrent caller that got there first,
    // and that caller's own listAccounts() call is the one that logs it.
    await logActivity({
      actorType: "system",
      actorLabel: "auto-seed",
      action: "account.created",
      entityType: "sender_account",
      entityId: String(created.id),
      summary: `Auto-seeded account "${seed.label}" from legacy env vars`,
    });
  } catch (err) {
    // Another concurrent caller (e.g. an overlapping cron tick, or a
    // request landing at the same moment) already seeded the same account
    // between our read above and this insert — not a real failure, just
    // re-read what it created instead of erroring out. Any other failure
    // (validation, a genuinely different DB error) still propagates.
    if (!isAccountConflictError(err)) throw err;
  }

  const seeded = await sql`SELECT * FROM sender_accounts ORDER BY id`;
  return seeded.map(fromRow);
}

export async function getAccount(id: number): Promise<SenderAccount | null> {
  const [row] = await sql`SELECT * FROM sender_accounts WHERE id = ${id}`;
  return row ? fromRow(row) : null;
}

export function getDecryptedSmtpPassword(account: SenderAccount): string {
  return decryptSecret(account.smtpPasswordEncrypted);
}

export async function createAccount(input: SaveAccountInput): Promise<SaveAccountResult> {
  validateInput(input);
  const password = input.smtpPassword?.trim();
  if (!password) {
    throw new Error("SMTP password is required");
  }

  try {
    const [row] = await sql`
      INSERT INTO sender_accounts (label, smtp_host, smtp_port, smtp_user, smtp_password_encrypted, hourly_cap, daily_cap, warmup_enabled)
      VALUES (${input.label?.trim() || input.smtpUser.trim()}, ${input.smtpHost.trim()}, ${input.smtpPort}, ${input.smtpUser.trim()}, ${encryptSecret(password)}, ${input.hourlyCap}, ${input.dailyCap}, ${input.warmupEnabled})
      RETURNING id
    `;
    return { id: row.id as number, warning: warningFor(input) };
  } catch (err) {
    if (isUniqueViolation(err)) {
      throw accountConflictError(input.smtpUser.trim());
    }
    throw err;
  }
}

export async function updateAccount(id: number, input: SaveAccountInput): Promise<SaveAccountResult> {
  validateInput(input);
  const existing = await getAccount(id);
  if (!existing) {
    throw new Error("Account not found");
  }
  const passwordEncrypted = input.smtpPassword?.trim() ? encryptSecret(input.smtpPassword.trim()) : existing.smtpPasswordEncrypted;

  try {
    await sql`
      UPDATE sender_accounts SET
        label = ${input.label?.trim() || input.smtpUser.trim()},
        smtp_host = ${input.smtpHost.trim()},
        smtp_port = ${input.smtpPort},
        smtp_user = ${input.smtpUser.trim()},
        smtp_password_encrypted = ${passwordEncrypted},
        hourly_cap = ${input.hourlyCap},
        daily_cap = ${input.dailyCap},
        warmup_enabled = ${input.warmupEnabled},
        updated_at = now()
      WHERE id = ${id}
    `;
    return { id, warning: warningFor(input) };
  } catch (err) {
    if (isUniqueViolation(err)) {
      throw accountConflictError(input.smtpUser.trim());
    }
    throw err;
  }
}

export async function resetWarmup(id: number): Promise<void> {
  await sql`UPDATE sender_accounts SET warmup_start_date = now(), updated_at = now() WHERE id = ${id}`;
}

// Pausing/resuming an account is the per-account replacement for the old
// campaign-level auto-pause — resuming clears the failure streak so it
// doesn't immediately re-pause on the next tick.
export async function setAccountStatus(id: number, status: AccountStatus): Promise<void> {
  if (status === "active") {
    await sql`UPDATE sender_accounts SET status = 'active', consecutive_failures = 0, updated_at = now() WHERE id = ${id}`;
  } else {
    await sql`UPDATE sender_accounts SET status = 'paused', updated_at = now() WHERE id = ${id}`;
  }
}

export interface EffectiveRateLimitConfig {
  hourlyCap: number;
  dailyCap: number;
  hourlyTarget: number;
  dailyTarget: number;
  warmupActive: boolean;
  warmupDay: number;
  warmupDays: number;
}

// Applies the warm-up ramp to one account's configured target caps.
export function getEffectiveRateLimitConfig(account: SenderAccount): EffectiveRateLimitConfig {
  const daysElapsed = (Date.now() - new Date(account.warmupStartDate).getTime()) / 86_400_000;
  const warmupActive = account.warmupEnabled && daysElapsed < DEFAULT_RAMP_DAYS;

  const hourlyCap = account.warmupEnabled
    ? computeWarmupCap(account.hourlyCap, WARMUP_HOURLY_FLOOR, daysElapsed)
    : account.hourlyCap;
  const dailyCap = account.warmupEnabled
    ? computeWarmupCap(account.dailyCap, WARMUP_DAILY_FLOOR, daysElapsed)
    : account.dailyCap;

  return {
    hourlyCap,
    dailyCap,
    hourlyTarget: account.hourlyCap,
    dailyTarget: account.dailyCap,
    warmupActive,
    warmupDay: Math.max(0, Math.min(DEFAULT_RAMP_DAYS, Math.floor(daysElapsed))),
    warmupDays: DEFAULT_RAMP_DAYS,
  };
}
