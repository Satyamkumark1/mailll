import { sql } from "./db.ts";
import { decryptSecret, encryptSecret } from "./secret-crypto.ts";
import { computeWarmupCap, DEFAULT_RAMP_DAYS } from "./warmup.ts";

// Zoho's own documented ceiling for external sending, regardless of
// reputation — see https://www.zoho.com/mail/help/adminconsole/rates-and-limits.html.
export const ZOHO_HARD_HOURLY_CEILING = 500;
// The low end of Zoho's reputation-based dynamic range — going above this
// without an established sending history is what risks a repeat block.
export const ZOHO_REPUTATION_HOURLY_FLOOR = 50;

const WARMUP_HOURLY_FLOOR = 10;
const WARMUP_DAILY_FLOOR = 40;

export interface SenderSettings {
  smtpHost: string;
  smtpPort: number;
  smtpUser: string;
  smtpPasswordEncrypted: string;
  hourlyCap: number;
  dailyCap: number;
  warmupEnabled: boolean;
  warmupStartDate: string;
}

export interface SaveSenderSettingsInput {
  smtpHost: string;
  smtpPort: number;
  smtpUser: string;
  smtpPassword?: string; // blank/undefined = keep existing
  hourlyCap: number;
  dailyCap: number;
  warmupEnabled: boolean;
}

export interface SaveSenderSettingsResult {
  warning: string | null;
}

function seedFromEnv(): SenderSettings | null {
  const user = process.env.EMAIL_USER?.trim();
  const pass = process.env.EMAIL_PASSWORD?.trim();
  if (!user || !pass) return null;
  return {
    smtpHost: process.env.EMAIL_HOST || "smtp.hostinger.com",
    smtpPort: Number(process.env.EMAIL_PORT) || 465,
    smtpUser: user,
    smtpPasswordEncrypted: encryptSecret(pass),
    hourlyCap: Number(process.env.EMAIL_HOURLY_CAP) || 35,
    dailyCap: Number(process.env.EMAIL_DAILY_CAP) || 150,
    warmupEnabled: true,
    warmupStartDate: new Date().toISOString(),
  };
}

// Reads the singleton row; if none exists yet, seeds one from the legacy
// EMAIL_* env vars (so an already-working account carries over with no
// manual re-entry) and persists that seed so future reads are stable.
export async function getSenderSettings(): Promise<SenderSettings | null> {
  const [row] = await sql`SELECT * FROM sender_settings WHERE id = 1`;
  if (row) {
    return {
      smtpHost: row.smtp_host as string,
      smtpPort: row.smtp_port as number,
      smtpUser: row.smtp_user as string,
      smtpPasswordEncrypted: row.smtp_password_encrypted as string,
      hourlyCap: row.hourly_cap as number,
      dailyCap: row.daily_cap as number,
      warmupEnabled: row.warmup_enabled as boolean,
      warmupStartDate: row.warmup_start_date as string,
    };
  }

  const seeded = seedFromEnv();
  if (!seeded) return null;

  await sql`
    INSERT INTO sender_settings (id, smtp_host, smtp_port, smtp_user, smtp_password_encrypted, hourly_cap, daily_cap, warmup_enabled, warmup_start_date)
    VALUES (1, ${seeded.smtpHost}, ${seeded.smtpPort}, ${seeded.smtpUser}, ${seeded.smtpPasswordEncrypted}, ${seeded.hourlyCap}, ${seeded.dailyCap}, ${seeded.warmupEnabled}, ${seeded.warmupStartDate})
    ON CONFLICT (id) DO NOTHING
  `;
  return seeded;
}

export function getDecryptedSmtpPassword(settings: SenderSettings): string {
  return decryptSecret(settings.smtpPasswordEncrypted);
}

export async function saveSenderSettings(input: SaveSenderSettingsInput): Promise<SaveSenderSettingsResult> {
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

  const existing = await getSenderSettings();
  const passwordEncrypted = input.smtpPassword?.trim()
    ? encryptSecret(input.smtpPassword.trim())
    : existing?.smtpPasswordEncrypted;
  if (!passwordEncrypted) {
    throw new Error("SMTP password is required");
  }

  await sql`
    INSERT INTO sender_settings (id, smtp_host, smtp_port, smtp_user, smtp_password_encrypted, hourly_cap, daily_cap, warmup_enabled, updated_at)
    VALUES (1, ${input.smtpHost.trim()}, ${input.smtpPort}, ${input.smtpUser.trim()}, ${passwordEncrypted}, ${input.hourlyCap}, ${input.dailyCap}, ${input.warmupEnabled}, now())
    ON CONFLICT (id) DO UPDATE SET
      smtp_host = EXCLUDED.smtp_host,
      smtp_port = EXCLUDED.smtp_port,
      smtp_user = EXCLUDED.smtp_user,
      smtp_password_encrypted = EXCLUDED.smtp_password_encrypted,
      hourly_cap = EXCLUDED.hourly_cap,
      daily_cap = EXCLUDED.daily_cap,
      warmup_enabled = EXCLUDED.warmup_enabled,
      updated_at = now()
  `;

  const warning =
    input.hourlyCap > ZOHO_REPUTATION_HOURLY_FLOOR
      ? `${input.hourlyCap}/hr is above the ${ZOHO_REPUTATION_HOURLY_FLOOR}/hr low end of Zoho's reputation-based range — safe for an established, high-reputation account, but risks another block on one that isn't.`
      : null;

  return { warning };
}

export async function resetWarmup(): Promise<void> {
  await sql`UPDATE sender_settings SET warmup_start_date = now(), updated_at = now() WHERE id = 1`;
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

// Applies the warm-up ramp to the configured target caps. Falls back to the
// pre-Settings-UI defaults (35/150, no ramp) if sender settings haven't
// been configured at all yet, so the rate limiter never hard-fails purely
// because Settings hasn't been opened.
export async function getEffectiveRateLimitConfig(): Promise<EffectiveRateLimitConfig> {
  const settings = await getSenderSettings();
  if (!settings) {
    return { hourlyCap: 35, dailyCap: 150, hourlyTarget: 35, dailyTarget: 150, warmupActive: false, warmupDay: 0, warmupDays: 0 };
  }

  const daysElapsed = (Date.now() - new Date(settings.warmupStartDate).getTime()) / 86_400_000;
  const warmupActive = settings.warmupEnabled && daysElapsed < DEFAULT_RAMP_DAYS;

  const hourlyCap = settings.warmupEnabled
    ? computeWarmupCap(settings.hourlyCap, WARMUP_HOURLY_FLOOR, daysElapsed)
    : settings.hourlyCap;
  const dailyCap = settings.warmupEnabled
    ? computeWarmupCap(settings.dailyCap, WARMUP_DAILY_FLOOR, daysElapsed)
    : settings.dailyCap;

  return {
    hourlyCap,
    dailyCap,
    hourlyTarget: settings.hourlyCap,
    dailyTarget: settings.dailyCap,
    warmupActive,
    warmupDay: Math.max(0, Math.min(DEFAULT_RAMP_DAYS, Math.floor(daysElapsed))),
    warmupDays: DEFAULT_RAMP_DAYS,
  };
}
