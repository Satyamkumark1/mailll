import fs from "node:fs";
import path from "node:path";

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

export function getRateLimitConfig(): RateLimitConfig {
  return {
    hourlyCap: Number(process.env.EMAIL_HOURLY_CAP) || 20,
    dailyCap: Number(process.env.EMAIL_DAILY_CAP) || 150,
  };
}

function getLogFilePath(): string {
  return path.join(process.cwd(), ".data", "send-log.json");
}

function readLogFile(): number[] {
  try {
    const filePath = getLogFilePath();
    if (!fs.existsSync(filePath)) {
      return [];
    }
    const raw = fs.readFileSync(filePath, "utf-8");
    const parsed = JSON.parse(raw);
    if (parsed && Array.isArray(parsed.attempts)) {
      return parsed.attempts.filter((t: unknown): t is number => typeof t === "number");
    }
    return [];
  } catch (err) {
    console.warn("Failed to read send-log.json, failing open:", err);
    return [];
  }
}

function writeLogFile(attempts: number[], now: number): void {
  try {
    const dataDir = path.join(process.cwd(), ".data");
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }
    const filePath = getLogFilePath();
    const pruned = attempts.filter((t) => t > now - DAILY_MS);
    fs.writeFileSync(filePath, JSON.stringify({ version: 1, attempts: pruned }, null, 2), "utf-8");
  } catch (err) {
    console.warn("Failed to write send-log.json:", err);
  }
}

export function peekRateLimitStatus(now = Date.now()): RateLimitStatus {
  const attempts = readLogFile();
  const config = getRateLimitConfig();
  return computeRateLimitStatus(attempts, config, now);
}

export function reserveSendSlot(now = Date.now()): RateLimitStatus {
  const attempts = readLogFile();
  const config = getRateLimitConfig();
  const status = computeRateLimitStatus(attempts, config, now);

  if (status.allowed) {
    const updatedAttempts = [...attempts, now];
    writeLogFile(updatedAttempts, now);
    return computeRateLimitStatus(updatedAttempts, config, now);
  }

  return status;
}
