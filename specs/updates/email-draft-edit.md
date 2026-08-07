# Focused Per-recipient Draft Editor

## Summary

After generation, open generated emails in a focused full-page editor so users can revise each recipient’s subject and body before copying, exporting, or sending. Edits remain in the existing browser-session state.

## Key Changes

- Extend the draft store with an `updateDraft(email, patch)` action that immutably updates only `subject` and `body` for the matching recipient.
- Replace the read-only draft-card list with a focused full-page editor and a compact setup-view **Review drafts** entry point:
  - The editor shows a read-only recipient name, brand, email, and **To** field with editable subject and multiline plain-text message fields.
  - Previous/next controls move between generated drafts and show the current draft position.
  - **Save changes** commits both fields to the store; **Discard changes** restores the saved subject and body.
  - Reject saving an empty/whitespace-only subject or body and show inline validation.
- Protect previous/next navigation, returning to generation settings, stage navigation, and **Start Over** with an unsaved-changes dialog offering **Save & continue**, **Discard changes**, or **Continue editing**.
- Ensure the updated store values are used by Copy, drafts CSV export, and the paced sender.
- Before generating a new draft set when drafts already exist, show a confirmation that all current drafts and manual edits will be replaced; cancelling preserves them.
- Disable draft editing and regeneration while a sending run is active, so an in-progress send queue cannot diverge from what the user sees.

## Test Plan

- Run lint and production build.
- Verify an edited subject/body appears correctly in the focused editor, copied text, and exported CSV.
- Verify the sender receives the edited subject/body payload.
- Verify **Discard changes** restores the original content, empty fields cannot be saved, and the unsaved-changes dialog protects previous/next, generation settings, and Start Over navigation.
- Verify regeneration confirmation preserves edits when declined and replaces them when confirmed.
- Verify editing/regeneration controls are unavailable during sending.

## Assumptions

- Editing is per recipient, not a bulk/template editor.
- Draft edits are session-only and are cleared by refresh or Start Over, consistent with the current in-memory app behavior.
- No API or database changes are needed; the existing send endpoint already accepts the editable subject and body.
 hey