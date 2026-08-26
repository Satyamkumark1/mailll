import test from "node:test";
import assert from "node:assert/strict";

// Set before importing the module under test — getKey() reads this lazily
// per call, not at import time, but set it up front regardless for clarity.
process.env.SETTINGS_ENCRYPTION_KEY = "0".repeat(64);

const { decryptSecret, encryptSecret } = await import("../secret-crypto.ts");

test("encryptSecret/decryptSecret round-trips a plaintext value", () => {
  const plain = "super-secret-app-password";
  const encrypted = encryptSecret(plain);
  assert.notEqual(encrypted, plain);
  assert.equal(decryptSecret(encrypted), plain);
});

test("encryptSecret produces different ciphertext for the same plaintext each call", () => {
  const a = encryptSecret("same-input");
  const b = encryptSecret("same-input");
  assert.notEqual(a, b, "random IV per call should make ciphertexts differ");
  assert.equal(decryptSecret(a), "same-input");
  assert.equal(decryptSecret(b), "same-input");
});

test("decryptSecret throws on tampered ciphertext rather than returning garbage", () => {
  const encrypted = encryptSecret("integrity-check");
  const tampered = Buffer.from(encrypted, "base64");
  tampered[tampered.length - 1] ^= 0xff;
  assert.throws(() => decryptSecret(tampered.toString("base64")));
});
