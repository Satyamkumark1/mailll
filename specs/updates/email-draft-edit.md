# Per-recipient AI Draft Editing

## Summary

Add an editor to each generated draft so users can revise that recipient’s subject and body before copying, exporting, or sending. Edits remain in the existing browser-session state.

## Key Changes

- Extend the draft store with an `updateDraft(email, patch)` action that immutably updates only `subject` and `body` for the matching recipient.
- Replace each read-only draft card’s content with an **Edit draft** flow:
  - Edit mode shows a subject input and multiline body textarea.
  - **Save changes** commits both fields to the store; **Cancel** discards unsaved local changes.
  - Reject saving an empty/whitespace-only subject or body and show inline validation.
  - Recipient name, brand, and email remain read-only.
- Ensure the updated store values are used by Copy, drafts CSV export, and the paced sender.
- Before generating a new draft set when drafts already exist, show a confirmation that all current drafts and manual edits will be replaced; cancelling preserves them.
- Disable draft editing and regeneration while a sending run is active, so an in-progress send queue cannot diverge from what the user sees.

## Test Plan

- Run lint and production build.
- Verify an edited subject/body appears correctly in the draft card, copied text, and exported CSV.
- Verify the sender receives the edited subject/body payload.
- Verify Cancel restores the original content, empty fields cannot be saved, and regeneration confirmation preserves edits on cancel but replaces them on confirm.
- Verify editing/regeneration controls are unavailable during sending.

## Assumptions

- Editing is per recipient, not a bulk/template editor.
- Draft edits are session-only and are cleared by refresh or Start Over, consistent with the current in-memory app behavior.
- No API or database changes are needed; the existing send endpoint already accepts the editable subject and body.
