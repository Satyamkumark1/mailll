import test from "node:test";
import assert from "node:assert/strict";
import { classifyBounceType } from "../bounce-checker.ts";

test("classifyBounceType: 5.x.x enhanced status is hard", () => {
  assert.equal(classifyBounceType("Status: 5.1.1\nDiagnostic-Code: smtp; 550 5.1.1 user unknown"), "hard");
});

test("classifyBounceType: 4.x.x enhanced status is soft", () => {
  assert.equal(classifyBounceType("Status: 4.2.2\nDiagnostic-Code: smtp; 452 mailbox full"), "soft");
});

test("classifyBounceType: bare 550 in diagnostic code is hard", () => {
  assert.equal(classifyBounceType("Diagnostic-Code: smtp; 550 no such user here"), "hard");
});

test("classifyBounceType: no recognizable code defaults to soft", () => {
  assert.equal(classifyBounceType("Delivery has failed for unknown reasons"), "soft");
});
