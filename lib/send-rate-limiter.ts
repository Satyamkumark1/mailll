import { sql } from "./db.ts";
import { getEffectiveRateLimitConfig } from "./sender-settings.ts";

export interface RateLimitConfig {
  hourlyCap: number;
  dailyCap: number;
}

export interface WindowStatus {
  used: number;
  cap: number;
  remaining: number;
}

export interface RateLimitStatus {
  allowed: boolean;
  hourly: WindowStatus;
  daily: WindowStatus;
  retryAfterSeconds: number; // 0 when allowed
}

const HOURLY_MS = 3600000;
const DAILY_MS = 86400000;

export function computeRateLimitStatus(
  attempts: number[],
  config: RateLimitConfig,
  now: number
): RateLimitStatus {
  const hourlyAttempts = attempts.filter((t) => t > now - HOURLY_MS);
  const dailyAttempts = attempts.filter((t) => t > now - DAILY_MS);

  const hourlyUsed = hourlyAttempts.length;
  const dailyUsed = dailyAttempts.length;

  const hourlyRemaining = Math.max(0, config.hourlyCap - hourlyUsed);
  const dailyRemaining = Math.max(0, config.dailyCap - dailyUsed);

  const hourlyBlocked = hourlyUsed >= config.hourlyCap;
  const dailyBlocked = dailyUsed >= config.dailyCap;
  const allowed = !hourlyBlocked && !dailyBlocked;

  let retryAfterSeconds = 0;

  if (!allowed) {
    let hourlyRetry = 0;
    let dailyRetry = 0;

    if (hourlyBlocked && hourlyAttempts.length > 0) {
      const oldestHourly = Math.min(...hourlyAttempts);
      const msUntilExpiry = oldestHourly + HOURLY_MS - now;
      hourlyRetry = Math.max(1, Math.ceil(msUntilExpiry / 1000));
    }

    if (dailyBlocked && dailyAttempts.length > 0) {
      const oldestDaily = Math.min(...dailyAttempts);
      const msUntilExpiry = oldestDaily + DAILY_MS - now;
      dailyRetry = Math.max(1, Math.ceil(msUntilExpiry / 1000));
    }

    retryAfterSeconds = Math.max(hourlyRetry, dailyRetry);
  }

  return {
    allowed,
    hourly: {
      used: hourlyUsed,
      cap: config.hourlyCap,
      remaining: hourlyRemaining,
    },
    daily: {
      used: dailyUsed,
      cap: config.dailyCap,
      remaining: dailyRemaining,
    },
    retryAfterSeconds,
  };
}

// Sourced from the Settings-UI-configured caps (lib/sender-settings.ts),
// with the warm-up ramp already applied — everything downstream (the rate
// limiter, campaign duration validation) automatically respects it with no
// further changes needed.
export async function getRateLimitConfig(): Promise<RateLimitConfig> {
  const effective = await getEffectiveRateLimitConfig();
  return { hourlyCap: effective.hourlyCap, dailyCap: effective.dailyCap };
}

async function readAttempts(now: number): Promise<number[]> {
  try {
    const rows = await sql`
      SELECT extract(epoch from sent_at) * 1000 AS ts
      FROM send_attempts
      WHERE sent_at > to_timestamp(${(now - DAILY_MS) / 1000})
    `;
    return rows.map((r) => Number(r.ts));
  } catch (err) {
    console.warn("Failed to read send_attempts, failing open:", err);
    return [];
  }
}

export async function peekRateLimitStatus(now = Date.now()): Promise<RateLimitStatus> {
  const attempts = await readAttempts(now);
  const config = await getRateLimitConfig();
  return computeRateLimitStatus(attempts, config, now);
}

export async function reserveSendSlot(now = Date.now()): Promise<RateLimitStatus> {
  const attempts = await readAttempts(now);
  const config = await getRateLimitConfig();
  const status = computeRateLimitStatus(attempts, config, now);

  if (status.allowed) {
    await sql`INSERT INTO send_attempts (sent_at) VALUES (to_timestamp(${now / 1000}))`;
    return computeRateLimitStatus([...attempts, now], config, now);
  }

  return status;
}
