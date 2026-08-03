import test from "node:test";
import assert from "node:assert/strict";
import { computeRateLimitStatus, type RateLimitConfig } from "../send-rate-limiter.ts";

const defaultConfig: RateLimitConfig = {
  hourlyCap: 20,
  dailyCap: 150,
};

test("computeRateLimitStatus allows sends below caps and calculates remaining correctly", () => {
  const now = 10000000;
  const attempts = [now - 1000, now - 2000]; // 2 attempts within last hour
  const status = computeRateLimitStatus(attempts, defaultConfig, now);

  assert.equal(status.allowed, true);
  assert.equal(status.hourly.used, 2);
  assert.equal(status.hourly.cap, 20);
  assert.equal(status.hourly.remaining, 18);
  assert.equal(status.daily.used, 2);
  assert.equal(status.daily.cap, 150);
  assert.equal(status.daily.remaining, 148);
  assert.equal(status.retryAfterSeconds, 0);
});

test("computeRateLimitStatus blocks when hourly cap is reached", () => {
  const now = 10000000;
  const config: RateLimitConfig = { hourlyCap: 3, dailyCap: 10 };
  const attempts = [now - 3000, now - 2000, now - 1000]; // 3 attempts in last hour (at now-3000, now-2000, now-1000)

  const status = computeRateLimitStatus(attempts, config, now);

  assert.equal(status.allowed, false);
  assert.equal(status.hourly.used, 3);
  assert.equal(status.hourly.remaining, 0);
  // Oldest attempt in hourly window is at now - 3000 ms.
  // It expires at now - 3000 + 3600000 ms.
  // Remaining ms = 3597000 ms -> 3597 seconds.
  assert.equal(status.retryAfterSeconds, 3597);
});

test("attempt 61 minutes old is excluded from hourly window but counts toward daily window", () => {
  const now = 10000000;
  const config: RateLimitConfig = { hourlyCap: 2, dailyCap: 5 };
  const sixtyOneMinAgo = now - 61 * 60 * 1000;
  const thirtyMinAgo = now - 30 * 60 * 1000;

  const attempts = [sixtyOneMinAgo, thirtyMinAgo];
  const status = computeRateLimitStatus(attempts, config, now);

  assert.equal(status.allowed, true);
  assert.equal(status.hourly.used, 1); // only 30 min ago is in hourly
  assert.equal(status.hourly.remaining, 1);
  assert.equal(status.daily.used, 2); // both are in daily
  assert.equal(status.daily.remaining, 3);
});

test("attempt 25 hours old is excluded from both hourly and daily windows", () => {
  const now = 10000000;
  const config: RateLimitConfig = { hourlyCap: 2, dailyCap: 5 };
  const twentyFiveHoursAgo = now - 25 * 60 * 60 * 1000;

  const attempts = [twentyFiveHoursAgo];
  const status = computeRateLimitStatus(attempts, config, now);

  assert.equal(status.allowed, true);
  assert.equal(status.hourly.used, 0);
  assert.equal(status.daily.used, 0);
});

test("daily cap blocks send even if hourly cap has headroom", () => {
  const now = 10000000;
  const config: RateLimitConfig = { hourlyCap: 10, dailyCap: 2 };
  const tenHoursAgo = now - 10 * 60 * 60 * 1000;
  const fiveHoursAgo = now - 5 * 60 * 60 * 1000;

  const attempts = [tenHoursAgo, fiveHoursAgo]; // 0 in hourly, 2 in daily
  const status = computeRateLimitStatus(attempts, config, now);

  assert.equal(status.allowed, false);
  assert.equal(status.hourly.used, 0);
  assert.equal(status.daily.used, 2);
  assert.equal(status.daily.remaining, 0);
  // Oldest in daily is tenHoursAgo (now - 10h).
  // Daily window = 24h. Expires at now - 10h + 24h = now + 14h.
  // 14 hours = 50,400 seconds.
  assert.equal(status.retryAfterSeconds, 50400);
});

test("retryAfterSeconds takes max of hourly and daily when both are blocking", () => {
  const now = 10000000;
  const config: RateLimitConfig = { hourlyCap: 1, dailyCap: 1 };
  // Oldest attempt is 10 sec ago -> blocks hourly and daily.
  // Hourly retry = 3600 - 10 = 3590s.
  // Daily retry = 86400 - 10 = 86390s.
  const attempts = [now - 10000];
  const status = computeRateLimitStatus(attempts, config, now);

  assert.equal(status.allowed, false);
  assert.equal(status.retryAfterSeconds, 86390);
});
