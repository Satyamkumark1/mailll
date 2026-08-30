import test from "node:test";
import assert from "node:assert/strict";

process.env.AUTH_SECRET = "test_auth_secret_32bytes_key_000000000000000000";

const { trackingClickUrl, verifyTrackingClickTarget } = await import("../tracking.ts");

test("trackingClickUrl signs the target and verifyTrackingClickTarget accepts it", () => {
  const url = trackingClickUrl("email-123", "https://example.com/path?x=1");
  const parsed = new URL(url);

  assert.equal(parsed.pathname, "/api/t/c/email-123");
  assert.equal(parsed.searchParams.get("u"), "https://example.com/path?x=1");
  assert.equal(verifyTrackingClickTarget("email-123", "https://example.com/path?x=1", parsed.searchParams.get("s")), true);
});

test("verifyTrackingClickTarget rejects mismatched targets and signatures", () => {
  const url = trackingClickUrl("email-123", "https://example.com/path?x=1");
  const parsed = new URL(url);

  assert.equal(verifyTrackingClickTarget("email-123", "https://example.com/path?x=2", parsed.searchParams.get("s")), false);
  assert.equal(verifyTrackingClickTarget("email-123", "https://example.com/path?x=1", null), false);
});
