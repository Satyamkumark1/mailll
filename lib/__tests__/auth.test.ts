import test from "node:test";
import assert from "node:assert/strict";

process.env.AUTH_SECRET = "test_auth_secret_32bytes_key_000000000000000000";

const { hashPassword, verifyPassword, createSessionToken, verifySessionToken } = await import("../auth.ts");

test("hashPassword/verifyPassword correctly verifies correct password and rejects invalid password", () => {
  const plainPassword = "MySecurePassword2026!";
  const hash = hashPassword(plainPassword);

  assert.notEqual(hash, plainPassword);
  assert.equal(verifyPassword(plainPassword, hash), true);
  assert.equal(verifyPassword("WrongPassword!", hash), false);
});

test("createSessionToken/verifySessionToken encodes and validates session tokens", async () => {
  const userId = "test-user-id-12345";
  const email = "admin@elevique.com";
  
  const token = await createSessionToken(userId, email);
  assert.equal(typeof token, "string");

  const session = await verifySessionToken(token);
  assert.notEqual(session, null);
  assert.equal(session?.userId, userId);
  assert.equal(session?.email, email);
});

test("verifySessionToken rejects tampered or malformed tokens", async () => {
  const token = await createSessionToken("user1", "user1@example.com");
  const tamperedToken = token.slice(0, -5) + "xxxxx";

  assert.equal(await verifySessionToken(tamperedToken), null);
  assert.equal(await verifySessionToken("invalid-token-format"), null);
  assert.equal(await verifySessionToken(null), null);
});
