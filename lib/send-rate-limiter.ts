import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

// Zoho's own limit is a dynamic 50-500 emails/hour based on sender reputation
// (no fixed daily number). These defaults are deliberately conservative since
// this mailbox was recently flagged for "unusual sending activity" - raise
// via EMAIL_HOURLY_CAP / EMAIL_DAILY_CAP in .env.local (restart the dev
// server to pick up changes) as reputation recovers.
const DEFAULT_HOURLY_CAP = 20;
const DEFAULT_DAILY_CAP = 150;

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

const LOG_DIR = path.join(process.cwd(), ".data");
const LOG_FILE = path.join(LOG_DIR, "send-log.json");

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
  retryAfterSeconds: number;
}

export function getRateLimitConfig(): RateLimitConfig {
  return {
    hourlyCap: Number(process.env.EMAIL_HOURLY_CAP) || DEFAULT_HOURLY_CAP,
    dailyCap: Number(process.env.EMAIL_DAILY_CAP) || DEFAULT_DAILY_CAP,
  };
}

function windowStatus(attempts: number[], now: number, windowMs: number, cap: number): WindowStatus {
  const used = attempts.filter((ts) => ts > now - windowMs).length;
  return { used, cap, remaining: Math.max(0, cap - used) };
}

// Seconds until the oldest attempt inside this window ages out of it.
function retrySecondsFor(attempts: number[], now: number, windowMs: number): number {
  const inWindow = attempts.filter((ts) => ts > now - windowMs).sort((a, b) => a - b);
  if (inWindow.length === 0) return 0;
  return Math.max(0, Math.ceil((inWindow[0] + windowMs - now) / 1000));
}

// Pure, unit-testable: given known attempt timestamps, is a new send allowed
// right now? Sliding windows (not fixed clock buckets), since Zoho's own
// hourly limit is framed as "any 60 minutes," not the top of the hour.
export function computeRateLimitStatus(
  attempts: number[],
  config: RateLimitConfig,
  now: number
): RateLimitStatus {
  const hourly = windowStatus(attempts, now, HOUR_MS, config.hourlyCap);
  const daily = windowStatus(attempts, now, DAY_MS, config.dailyCap);
  const allowed = hourly.used < hourly.cap && daily.used < daily.cap;

  let retryAfterSeconds = 0;
  if (!allowed) {
    const retries: number[] = [];
    if (hourly.used >= hourly.cap) retries.push(retrySecondsFor(attempts, now, HOUR_MS));
    if (daily.used >= daily.cap) retries.push(retrySecondsFor(attempts, now, DAY_MS));
    retryAfterSeconds = Math.max(0, ...retries);
  }

  return { allowed, hourly, daily, retryAfterSeconds };
}

// Only attempts from the last 24h matter for either window - drop the rest
// so the log file stays small and old entries never re-enter the daily count.
function readAttempts(now: number): number[] {
  let raw: string;
  try {
    raw = readFileSync(LOG_FILE, "utf8");
  } catch {
    return [];
  }
  try {
    const parsed = JSON.parse(raw) as { attempts?: unknown };
    if (!Array.isArray(parsed.attempts)) return [];
    return parsed.attempts.filter((ts): ts is number => typeof ts === "number" && ts > now - DAY_MS);
  } catch (err) {
    console.warn("[send-rate-limiter] corrupt send log, treating as empty:", err);
    return [];
  }
}

function writeAttempts(attempts: number[]): void {
  try {
    if (!existsSync(LOG_DIR)) mkdirSync(LOG_DIR, { recursive: true });
    writeFileSync(LOG_FILE, JSON.stringify({ version: 1, attempts }), "utf8");
  } catch (err) {
    // Local safety net, not a security boundary - fail open rather than
    // permanently blocking sends over a filesystem hiccup the user can't fix.
    console.warn("[send-rate-limiter] failed to persist send log, allowing send:", err);
  }
}

// Read-only: what would happen if a send were attempted right now.
export function peekRateLimitStatus(now = Date.now()): RateLimitStatus {
  return computeRateLimitStatus(readAttempts(now), getRateLimitConfig(), now);
}

// Reserves a slot for an attempt about to be made. Every attempt counts
// toward the cap regardless of whether the send later succeeds or fails,
// since a rejected send is still an SMTP transaction Zoho observes - so this
// must be called (and durably recorded) before opening the SMTP connection,
// not after the result is known.
//
// `allowed` on the returned status means "this reservation succeeded" - it
// stays true even when the reservation was the last one available (e.g. the
// count just reached the cap), since that attempt itself is still allowed to
// proceed. It's only false when the cap was already reached *before* this
// call, in which case nothing is recorded. used/remaining always reflect the
// current counts either way.
export function reserveSendSlot(now = Date.now()): RateLimitStatus {
  const config = getRateLimitConfig();
  const attempts = readAttempts(now);
  const preStatus = computeRateLimitStatus(attempts, config, now);
  if (!preStatus.allowed) return preStatus;

  const updated = [...attempts, now];
  writeAttempts(updated);
  return { ...computeRateLimitStatus(updated, config, now), allowed: true };
}
