import test from "node:test";
import assert from "node:assert/strict";

process.env.AUTH_SECRET = "test_auth_secret_32bytes_key_000000000000000000";

const { buildEmailHtml } = await import("../email-signature.ts");

test("buildEmailHtml keeps terminal punctuation outside the tracked URL", () => {
  const html = buildEmailHtml(
    {
      senderName: "Tester",
      company: "Example Co",
      pitch: "",
      cta: "",
      signature: "Regards,\nTester",
      proofPoints: "https://example.com/portfolio.",
      businessAddress: "",
      tone: "casual",
      title: "Founder",
      mobile: "123",
      contactEmail: "test@example.com",
      website: "example.com",
      customHook: "",
    },
    "https://example.com/portfolio.",
    "cid:logo",
    "email-1"
  );

  assert.match(html, />https:\/\/example\.com\/portfolio<\/a>\./);
  assert.match(html, /u=https%3A%2F%2Fexample\.com%2Fportfolio&/);
  assert.equal(html.includes("portfolio.&"), false);
});
