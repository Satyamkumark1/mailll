import test from "node:test";
import assert from "node:assert/strict";
import { computeRateLimitStatus } from "../send-rate-limiter.ts";

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const CONFIG = { hourlyCap: 20, dailyCap: 150 };

test("allows sends while under both caps", () => {
  const now = Date.now();
  const attempts = Array.from({ length: 19 }, (_, i) => now - i * 1000);
  const status = computeRateLimitStatus(attempts, CONFIG, now);
  assert.equal(status.allowed, true);
  assert.equal(status.hourly.used, 19);
  assert.equal(status.hourly.remaining, 1);
  assert.equal(status.retryAfterSeconds, 0);
});

test("blocks the attempt that would exceed the hourly cap", () => {
  const now = Date.now();
  const attempts = Array.from({ length: 20 }, (_, i) => now - i * 1000);
  const status = computeRateLimitStatus(attempts, CONFIG, now);
  assert.equal(status.allowed, false);
  assert.equal(status.hourly.used, 20);
  assert.equal(status.hourly.remaining, 0);
  assert.ok(status.retryAfterSeconds > 0);
});

test("sliding window: an attempt just over an hour old drops out of the hourly count but still counts toward the daily count", () => {
  const now = Date.now();
  const attempts = [now - (HOUR_MS + 60_000)]; // 61 minutes ago
  const status = computeRateLimitStatus(attempts, CONFIG, now);
  assert.equal(status.hourly.used, 0);
  assert.equal(status.daily.used, 1);
  assert.equal(status.allowed, true);
});

test("an attempt over 24h old is excluded from both windows", () => {
  const now = Date.now();
  const attempts = [now - (DAY_MS + HOUR_MS)]; // 25 hours ago
  const status = computeRateLimitStatus(attempts, CONFIG, now);
  assert.equal(status.hourly.used, 0);
  assert.equal(status.daily.used, 0);
});

test("daily cap blocks even when the hourly window has headroom", () => {
  const now = Date.now();
  // 150 attempts spread evenly across the 23h before the last hour - none in
  // the last hour, so hourly has full headroom, but daily is exactly at cap.
  const attempts = Array.from(
    { length: 150 },
    (_, i) => now - HOUR_MS - i * ((DAY_MS - HOUR_MS) / 150)
  );
  const status = computeRateLimitStatus(attempts, CONFIG, now);
  assert.equal(status.hourly.used, 0);
  assert.equal(status.daily.used, 150);
  assert.equal(status.allowed, false);
});

test("retryAfterSeconds is the max of hourly and daily retry when both windows are blocking", () => {
  const now = Date.now();
  // 20 attempts within the last hour (hourly blocked) plus enough older
  // same-day attempts to also hit the daily cap of 150 (oldest ~20h ago,
  // so its retry window is the larger of the two).
  const recent = Array.from({ length: 20 }, (_, i) => now - i * 60_000 - 5000); // within last ~30min
  const older = Array.from({ length: 130 }, (_, i) => now - 20 * HOUR_MS - i * 1000);
  const attempts = [...recent, ...older];
  const status = computeRateLimitStatus(attempts, CONFIG, now);
  assert.equal(status.allowed, false);
  assert.equal(status.hourly.used, 20);
  assert.equal(status.daily.used, 150);

  const oldestHourly = Math.min(...recent);
  const oldestDaily = Math.min(...attempts);
  const expectedHourlyRetry = Math.ceil((oldestHourly + HOUR_MS - now) / 1000);
  const expectedDailyRetry = Math.ceil((oldestDaily + DAY_MS - now) / 1000);
  assert.equal(status.retryAfterSeconds, Math.max(expectedHourlyRetry, expectedDailyRetry));
});
