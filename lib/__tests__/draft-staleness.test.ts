import test from "node:test";
import assert from "node:assert/strict";
import { useValidatorStore } from "../store.ts";
import { computeDraftsStale } from "../utils.ts";

function emptyRow(email: string) {
  return { email, brand: "", category: "", linkedinUrl: "", pocName: "", pocDesignation: "" };
}

// Mirrors app/validator/page.tsx: `tabEnabled("send")` requires
// `drafts.length > 0 && !draftsStale`, where draftsStale comes from computeDraftsStale.
function sendTabEnabled(validContacts: { email: string }[], drafts: { email: string }[]) {
  return drafts.length > 0 && !computeDraftsStale(validContacts, drafts);
}

test("bulk-approving flagged emails locks Send until drafts are regenerated", () => {
  useValidatorStore.setState({ results: [], drafts: [] });

  useValidatorStore.getState().appendResults([
    { ...emptyRow("valid@x.com"), status: "valid", reason: "ok" },
    { ...emptyRow("flagged@x.com"), status: "flagged", reason: "ambiguous" },
  ]);

  let validContacts = useValidatorStore.getState().results.filter((r) => r.status === "valid");
  assert.equal(validContacts.length, 1);

  // Drafts generated for the currently-valid contact only.
  useValidatorStore.getState().appendDrafts([
    { email: "valid@x.com", pocName: "", brand: "", subject: "s", body: "b" },
  ]);
  let drafts = useValidatorStore.getState().drafts;

  assert.equal(computeDraftsStale(validContacts, drafts), false);
  assert.equal(sendTabEnabled(validContacts, drafts), true);

  // Bulk-approve the flagged email — mirrors clicking "Mark All Flagged Valid".
  useValidatorStore.getState().markAllFlaggedValid();
  validContacts = useValidatorStore.getState().results.filter((r) => r.status === "valid");
  assert.equal(validContacts.length, 2);

  // Drafts array hasn't changed yet — it's now stale relative to valid contacts,
  // and Send must be locked so the newly-approved contact can't be silently skipped.
  assert.equal(computeDraftsStale(validContacts, drafts), true);
  assert.equal(sendTabEnabled(validContacts, drafts), false);

  // Regenerating drafts (the explicit path, which preserves/discards manual edits
  // via its own confirmation flow) brings drafts back in sync and unlocks Send.
  drafts = validContacts.map((c) => ({ email: c.email, pocName: "", brand: "", subject: "s", body: "b" }));
  assert.equal(computeDraftsStale(validContacts, drafts), false);
  assert.equal(sendTabEnabled(validContacts, drafts), true);
});

test("computeDraftsStale is false when there are no drafts yet", () => {
  assert.equal(computeDraftsStale([{ email: "a@x.com" }], []), false);
});

test("computeDraftsStale ignores drafts that cover a superset of valid contacts", () => {
  const validContacts = [{ email: "a@x.com" }];
  const drafts = [{ email: "a@x.com" }, { email: "b@x.com" }];
  assert.equal(computeDraftsStale(validContacts, drafts), false);
});
