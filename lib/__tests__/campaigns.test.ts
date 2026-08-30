import test from "node:test";
import assert from "node:assert/strict";
import { shouldPauseAccount, summarizeDispatchResults, type DispatchOutcome } from "../campaigns.ts";

function fulfilled(value: DispatchOutcome): PromiseSettledResult<DispatchOutcome> {
  return { status: "fulfilled", value };
}
function rejected(reason: unknown): PromiseSettledResult<DispatchOutcome> {
  return { status: "rejected", reason };
}

test("shouldPauseAccount is false below the threshold", () => {
  assert.equal(shouldPauseAccount(0), false);
  assert.equal(shouldPauseAccount(1), false);
});

test("shouldPauseAccount is true at and above the threshold", () => {
  assert.equal(shouldPauseAccount(2), true);
  assert.equal(shouldPauseAccount(3), true);
});

test("summarizeDispatchResults tallies each fulfilled outcome into its own bucket", () => {
  const summary = summarizeDispatchResults([fulfilled("sent"), fulfilled("sent"), fulfilled("failed"), fulfilled("deferred")]);
  assert.deepEqual(summary, { sent: 2, failed: 1, deferred: 1, errored: 0 });
});

test("summarizeDispatchResults counts a rejected reservation (reserveSendSlot throwing) as errored, not skipped", () => {
  const summary = summarizeDispatchResults([
    fulfilled("sent"),
    rejected(new Error("reserveSendSlot: connection to send_attempts timed out")),
  ]);
  assert.deepEqual(summary, { sent: 1, failed: 0, deferred: 0, errored: 1 });
});

test("summarizeDispatchResults counts a rejected result-write (recordEmailResult throwing) as errored, not skipped", () => {
  const summary = summarizeDispatchResults([
    fulfilled("sent"),
    rejected(new Error("recordEmailResult: UPDATE campaign_emails failed")),
  ]);
  assert.deepEqual(summary, { sent: 1, failed: 0, deferred: 0, errored: 1 });
});

test("summarizeDispatchResults never drops a result: total tallied always equals input length", () => {
  const results: PromiseSettledResult<DispatchOutcome>[] = [
    fulfilled("sent"),
    rejected(new Error("reservation failed")),
    fulfilled("deferred"),
    rejected(new Error("result write failed")),
    fulfilled("failed"),
  ];
  const summary = summarizeDispatchResults(results);
  assert.equal(summary.sent + summary.failed + summary.deferred + summary.errored, results.length);
  assert.deepEqual(summary, { sent: 1, failed: 1, deferred: 1, errored: 2 });
});
