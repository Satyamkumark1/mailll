import test from "node:test";
import assert from "node:assert/strict";
import { computeMinDurationHours, computeScheduledTimes, formatDurationHours } from "../campaign-schedule.ts";

test("computeScheduledTimes spaces times evenly across the window", () => {
  const start = new Date("2026-01-01T00:00:00Z");
  const end = new Date("2026-01-01T10:00:00Z");
  const times = computeScheduledTimes(10, start, end);

  assert.equal(times.length, 10);
  for (const t of times) {
    assert.ok(t.getTime() >= start.getTime(), "time is not before window start");
    assert.ok(t.getTime() <= end.getTime(), "time is not after window end");
  }
});

test("computeScheduledTimes returns times in ascending order", () => {
  const start = new Date("2026-01-01T00:00:00Z");
  const end = new Date("2026-01-02T00:00:00Z");
  const times = computeScheduledTimes(50, start, end);

  for (let i = 1; i < times.length; i++) {
    assert.ok(times[i].getTime() >= times[i - 1].getTime(), "times must be non-decreasing");
  }
});

test("computeScheduledTimes handles zero and one email", () => {
  const start = new Date("2026-01-01T00:00:00Z");
  const end = new Date("2026-01-01T01:00:00Z");

  assert.deepEqual(computeScheduledTimes(0, start, end), []);

  const single = computeScheduledTimes(1, start, end);
  assert.equal(single.length, 1);
  assert.ok(single[0].getTime() >= start.getTime());
  assert.ok(single[0].getTime() <= end.getTime());
});

test("computeMinDurationHours stays small for a couple of emails", () => {
  // 2 emails at a 35/hr cap shouldn't be forced into a full 1-hour window —
  // this is the behavior the user explicitly asked for ("if the mails are
  // less it should go quick").
  const minHours = computeMinDurationHours(2, 35);
  assert.ok(minHours < 1, `expected under an hour, got ${minHours}`);
  assert.ok(minHours > 0);
});

test("computeMinDurationHours is driven by the cap once count approaches it", () => {
  const minHours = computeMinDurationHours(400, 35);
  assert.ok(minHours >= 400 / 35 - 0.001, "must be at least the cap-driven minimum");
});

test("computeMinDurationHours is zero for zero emails", () => {
  assert.equal(computeMinDurationHours(0, 35), 0);
});

test("formatDurationHours renders sub-hour durations as minutes", () => {
  assert.equal(formatDurationHours(0.05), "3 minutes");
  assert.equal(formatDurationHours(1 / 60), "1 minute");
});

test("formatDurationHours renders hour-plus durations as hours", () => {
  assert.equal(formatDurationHours(1), "1 hour");
  assert.equal(formatDurationHours(11.43), "11.5 hours");
});
