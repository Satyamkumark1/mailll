import test from "node:test";
import assert from "node:assert/strict";
import { computeScheduledTimes } from "../campaigns.ts";

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
