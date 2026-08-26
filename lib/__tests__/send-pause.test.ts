import test from "node:test";
import assert from "node:assert/strict";
import { sendDraftsPaced } from "../email-sender.ts";
import { ELEVIQUE_OUTREACH_CONFIG, type DraftResult } from "../store.ts";

function draft(email: string): DraftResult {
  return { email, pocName: "Test", brand: "Brand", subject: "Subject", body: "Body" };
}

function jsonResponse(ok: boolean, status: number, body: Record<string, unknown>) {
  return { ok, status, json: async () => body } as Response;
}

test("sendDraftsPaced pauses after 2 consecutive failures and never sends the rest", async () => {
  const calls: string[] = [];
  const originalFetch = global.fetch;
  global.fetch = (async (input: RequestInfo | URL) => {
    calls.push(String(input));
    return jsonResponse(false, 502, { error: "SMTP rejected" });
  }) as typeof fetch;

  const results: string[] = [];
  let pausedCount: number | null = null;
  try {
    await sendDraftsPaced(
      [draft("a@x.com"), draft("b@x.com"), draft("c@x.com")],
      ELEVIQUE_OUTREACH_CONFIG,
      0,
      0,
      () => {},
      (result) => results.push(result.email),
      () => false,
      undefined,
      true,
      undefined,
      (failCount) => {
        pausedCount = failCount;
      }
    );
  } finally {
    global.fetch = originalFetch;
  }

  assert.equal(calls.length, 2, "should stop after the 2nd failed send, never attempting the 3rd");
  assert.deepEqual(results, ["a@x.com", "b@x.com"]);
  assert.equal(pausedCount, 2);
});

test("sendDraftsPaced resets the streak on a success, so it never pauses", async () => {
  const originalFetch = global.fetch;
  let call = 0;
  global.fetch = (async () => {
    call++;
    // fail, succeed, fail — no two failures back-to-back.
    if (call === 2) return jsonResponse(true, 200, { success: true });
    return jsonResponse(false, 502, { error: "SMTP rejected" });
  }) as typeof fetch;

  const results: string[] = [];
  let paused = false;
  try {
    await sendDraftsPaced(
      [draft("a@x.com"), draft("b@x.com"), draft("c@x.com")],
      ELEVIQUE_OUTREACH_CONFIG,
      0,
      0,
      () => {},
      (result) => results.push(result.email),
      () => false,
      undefined,
      true,
      undefined,
      () => {
        paused = true;
      }
    );
  } finally {
    global.fetch = originalFetch;
  }

  assert.equal(call, 3, "all 3 drafts should have been attempted");
  assert.deepEqual(results, ["a@x.com", "b@x.com", "c@x.com"]);
  assert.equal(paused, false);
});
