import test from "node:test";
import assert from "node:assert/strict";
import { computeWarmupCap } from "../warmup.ts";

test("computeWarmupCap starts at the floor on day zero", () => {
  assert.equal(computeWarmupCap(35, 10, 0), 10);
});

test("computeWarmupCap reaches the target once rampDays have elapsed", () => {
  assert.equal(computeWarmupCap(35, 10, 14, 14), 35);
  assert.equal(computeWarmupCap(35, 10, 20, 14), 35);
});

test("computeWarmupCap ramps linearly in between", () => {
  const midpoint = computeWarmupCap(35, 10, 7, 14);
  assert.equal(midpoint, 10 + Math.round((35 - 10) * 0.5));
});

test("computeWarmupCap returns the target unchanged if it's already at or below the floor", () => {
  assert.equal(computeWarmupCap(5, 10, 0), 5);
  assert.equal(computeWarmupCap(10, 10, 0), 10);
});

test("computeWarmupCap clamps negative elapsed days to the floor", () => {
  assert.equal(computeWarmupCap(35, 10, -3, 14), 10);
});
