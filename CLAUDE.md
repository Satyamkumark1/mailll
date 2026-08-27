# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

@AGENTS.md

## Commands

- `npm run dev` — start the Next.js (Turbopack) dev server at localhost:3000
- `npm run build` — production build
- `npm run lint` — ESLint (flat config: `eslint-config-next` core-web-vitals + typescript)
- `npx tsc --noEmit -p .` — typecheck the main app (no dedicated `npm run typecheck` script exists)
- `npm test` — runs `node --test`, which picks up test files under `lib/__tests__/`. To run a single file: `node --test lib/__tests__/draft-staleness.test.ts`
- `npm run build:verifier` — compiles `verifier-service/` (a separate standalone service, see below) using its own `verifier-service/tsconfig.json`
- `npm run start:verifier` — runs the built verifier service from `verifier-service/dist/`

## Environment

`.env.local` (gitignored) needs `NEXT_PUBLIC_GROQ_API_KEY`, `DATABASE_URL` (Postgres — backs the send-rate limiter, sender settings, and background campaigns; required to send any email at all, not just scheduled ones), and `SETTINGS_ENCRYPTION_KEY` (32-byte hex, encrypts the SMTP password stored via the Settings modal — see below). Optional, for deep email verification off Vercel: `ABSTRACT_API_KEY`, `VERIFIER_SERVICE_URL`, `VERIFIER_SHARED_SECRET` — see "Deep verification" below. `CRON_SECRET` is required only if using background send campaigns — see below. `EMAIL_USER`/`EMAIL_PASSWORD`/`EMAIL_HOST`/`EMAIL_PORT`/`EMAIL_HOURLY_CAP`/`EMAIL_DAILY_CAP` are legacy — they're only read once, to seed the database the first time sender settings are read with no row yet present; the Settings modal (gear icon) is the source of truth after that.

## Architecture

### One page, seven stages

Almost the entire app lives in one client component, `app/validator/page.tsx`, which renders one of seven stages based on `activeTab` in the Zustand store: **Upload → Validate → Results → Draft → Send → Export → History**. Stage metadata (labels/icons/descriptions) is centralized in `lib/tabs.ts`. `tabEnabled()` in the page gates which stages are reachable (e.g. Draft requires `validContacts.length > 0`, derived from `results`) — Upload and History are always reachable, since History reads campaign state fresh from the server rather than depending on pipeline progress.

All pipeline state — uploaded rows, validation results, drafts, send results, outreach config, progress counters — lives in one store, `useValidatorStore` in `lib/store.ts`. There's no persistence middleware, so a refresh clears everything; this is intentional (see `specs/updates/email-draft-edit.md`).

`app/page.tsx` is a separate marketing landing page; `DESIGN_MASTER_PROMPT.md` is the design brief used for its (and the app's) visual redesign — check it before making significant UI/visual changes.

### Validation pipeline, three layers (`lib/groq-validator.ts`)

`validateEmails()` runs each row (batches of 20) through, in order:

1. **Heuristic check** (`heuristicCheck`) — format regex, disposable-domain list (`lib/disposable-domains.ts`), spam-trap/role-based local-part patterns (`lib/utils.ts`). Synchronous, no network.
2. **Deep MX/SMTP verify** (`deepVerifyBatch` → `POST /api/verify-email`) — only for rows that survived step 1.
3. **Groq AI pass** (`callGroqWithRetry`) — confirms or overturns the combined verdict. Retries once on HTTP 429 after a 15s wait, throws hard on 401, and falls back to the pre-AI verdict on any other failure.

### Deep verification has three backends, chosen per-request (`app/api/verify-email/route.ts`)

Real mailbox verification means speaking raw SMTP (`lib/smtp-verifier.ts`: connect on port 25, `MAIL FROM`/`RCPT TO`, read the accept/reject code, plus a catch-all check via 2 random-address probes at the same domain). **Vercel blocks outbound port 25**, so the route picks a strategy at request time, in priority order:

1. `ABSTRACT_API_KEY` set → call Abstract API's HTTPS endpoint (external service, no infra needed, capped at 20 emails/request).
2. `VERIFIER_SERVICE_URL` set → proxy to a self-hosted instance of `verifier-service/` (a standalone Node HTTP server, built and deployed separately from the Next.js app — see `verifier-service/deploy.sh` for VPS setup with Caddy/pm2) running the same `deepVerify()` logic somewhere port 25 isn't blocked.
3. Neither set → run `deepVerify()` in-process (works locally, where port 25 is often open).

`lib/smtp-verifier.ts` is server-only (uses Node's `dns`/`net`) — never import it from client code. It caches domain-level verdicts (30 min TTL) for facts that hold for the whole domain (no MX, catch-all, unreachable) but never caches a specific mailbox's valid/invalid verdict; keeps a known-unreliable-provider skip list (Outlook/Yahoo/AOL — Gmail is deliberately excluded, since it was tested to give reliable per-mailbox signals); and retries once before finalizing an "invalid" result, since a single rejection can be transient greylisting.

### Draft generation (`lib/draft-generator.ts`)

`generateDrafts()` builds one `DraftResult` per valid contact:

- If `config.customHook` is set, every draft uses that exact text verbatim as the hook and Groq is skipped entirely (this path needs no API key).
- Otherwise Groq is called in batches of 8. The prompt gives it 4 fixed hook "versions" to rotate between per contact (never repeating the same one back-to-back) and fill in `{Brand}`/`{category}` — deliberately constrained rather than freeform, to control hallucination and repetition. See the prompt string in `callGroq` for the exact rules if tuning tone/wording.
- The subject line is always deterministic (`Noticed something about {Brand}'s content`) — the AI's subject suggestion is never trusted.
- `formatHookLines()` normalizes whatever hook text comes back into exactly two lines, falling back to a hardcoded default hook if it can't.
- `buildEleviqueBody()` assembles the final plain-text body: greeting (first name only) → hook → pitch → proof line → CTA → signature. Pitch/CTA/proof-points/signature are static, from `OutreachConfig`, not AI-generated.

### HTML email signature is a send-time-only transform (`lib/email-signature.ts`)

Drafts are plain text everywhere in the app (editor, CSV/TXT export, copy-to-clipboard). Only at actual send time does `buildEmailHtml()` convert the plain body to HTML and append a styled signature — the plain-text `config.signature` is stripped off the end (exact string match) before the styled HTML version replaces it. The logo is embedded via a CID attachment (`LOGO_CID`), attached server-side in `lib/send-mail.ts` from `public/elevique-logo.png` — deliberately not a remote `<img src>` URL, since mail clients commonly block remote images by default.

### Sending is exclusively via background campaigns (`lib/send-mail.ts` + `app/api/cron/tick`)

An earlier "Send now" mode (a client-driven `setTimeout` pacing loop in the browser tab, hitting `POST /api/send-email`) was removed — it shared the same send-rate budget as background campaigns (`lib/send-rate-limiter.ts`) with no way to prioritize between them, so a stray immediate send from one tab/session could silently starve a running campaign with no obvious cause. `app/api/send-email/route.ts` now only exposes `GET` (rate-limit status, for display). Nodemailer transport setup and the CID logo attachment live in `lib/send-mail.ts`'s `sendMailDirect()`, shared by the cron worker below, which builds a fresh transporter per call from `lib/sender-settings.ts` rather than caching one, since the account can change at runtime via Settings.

### Self-service sender settings + Zoho-guided warm-up (`lib/sender-settings.ts`, `lib/secret-crypto.ts`, `lib/warmup.ts`)

The SMTP account and hourly/daily send caps are configured in-app via the gear-icon **Settings modal** in `app/validator/page.tsx`, not fixed env vars — `sender_settings` is a singleton Postgres row (`lib/schema.sql`, `id = 1` enforced by a CHECK constraint). The password is AES-256-GCM encrypted before it touches the DB (`lib/secret-crypto.ts`, keyed by `SETTINGS_ENCRYPTION_KEY`) and never returned by `GET /api/settings` (`hasPassword: boolean` instead) — `saveSenderSettings()` treats a blank password field as "keep the existing one." If no row exists yet, `getSenderSettings()` seeds one from the legacy `EMAIL_*` env vars so an already-working account carries over with no manual re-entry.

Cap guardrails come from Zoho's own documented limits (https://www.zoho.com/mail/help/adminconsole/rates-and-limits.html: external sending is reputation-based, dynamically capped 50-500/hr) — `saveSenderSettings()` hard-rejects an hourly cap above 500 and returns a non-blocking `warning` above 50. On top of the configured target caps, `lib/warmup.ts`'s pure `computeWarmupCap()` ramps the *effective* cap from a conservative floor up to the target over ~14 days (`warmup_start_date`, resettable via `POST /api/settings/reset-warmup` — e.g. after a block clears) — this follows Zoho's own advice to ramp volume up gradually rather than jump to a flat number. `lib/send-rate-limiter.ts`'s `getRateLimitConfig()` sources from `getEffectiveRateLimitConfig()`, so the ramp is enforced everywhere the cap is checked (campaign scheduling, the cron tick) with no other code changes needed.

### Send-rate limiting is DB-backed, not file-based (`lib/send-rate-limiter.ts`)

`computeRateLimitStatus()` is a pure function (unit-tested in `lib/__tests__/send-rate-limiter.test.ts`) — don't touch its signature lightly. Around it, `peekRateLimitStatus()`/`reserveSendSlot()` read/write a `send_attempts` table via `lib/db.ts` (Neon Postgres, `DATABASE_URL`) rather than a local file, since Vercel's serverless filesystem isn't reliably persistent across invocations. `reserveSendSlot(source)` tags every reservation with a `source` column (`'immediate'` — legacy rows only, `'campaign'` — the cron worker) so a stall caused by unexpected contention for the shared budget shows up as a breakdown in the UI (`describeRateLimitBlock()`/`formatSourceBreakdown()`) instead of requiring a manual DB query.

### Background send campaigns survive closing the browser (`lib/campaigns.ts` + `app/api/campaigns/*` + `app/api/cron/tick`)

If you have hundreds of drafts, closing the tab (or the laptop sleeping) can't be allowed to kill the send — so scheduling a campaign snapshots the drafts + pre-rendered HTML into Postgres (`campaigns`/`campaign_emails` tables — see `lib/schema.sql`, run once via the Neon SQL console) with a `scheduled_at` per email computed by `computeScheduledTimes()` (evenly spaced across the chosen duration, with jitter). `createCampaign()` also accepts an optional `startAt` — pick "Start at a specific time" in the UI instead of "Start now" to have the window begin at a chosen future clock time rather than immediately; a past/omitted `startAt` just means "now." The duration itself defaults to `computeMinDurationHours()` — the shortest window that still keeps a human-ish gap between sends and respects the hourly cap — rather than a fixed number, so a 2-email test campaign gets scheduled over a few minutes, not forced into a full hour just because a 400-email campaign would need one. Both are pure functions living in `lib/campaign-schedule.ts` (deliberately DB-free so the client can import them too, to compute/display the minimum before submitting), unit-tested in `lib/__tests__/campaign-schedule.test.ts`. Before scheduling, a Recipients checklist on the Send stage (backed by `excludedEmails` component state, not the store) lets specific drafts be excluded from that run.

A campaign's per-email rows can also end up `'skipped'` (distinct from `'canceled'`) via `skipCampaignEmails()`/`POST /api/campaigns/:id/skip` — pulling specific still-pending rows out without canceling the whole campaign; skipped rows are permanently excluded and, unlike `'canceled'` ones, are never picked up by `restartCampaign()`. A fully `'canceled'` campaign (every pending row flipped to `'canceled'`) can be brought back via `restartCampaign()`/`POST /api/campaigns/:id/restart`, which reschedules those rows over a fresh window starting now (their old `scheduled_at` values are stale) rather than just flipping the status bit back — that's what the auto-pause path (`resumeCampaign()`, below) does instead.

The **History** stage (`listCampaigns()`, `GET /api/campaigns`) lists every campaign ever created, read fresh from Postgres — unlike the single "active" campaign tracked via a `localStorage` id on the Send stage, History has no client-side dependency at all, so it's the one place a campaign's outcome (including failures) is always visible regardless of which browser/tab/device you check from.

Nothing sends anything until something calls `POST /api/cron/tick` (guarded by `?secret=` or `Authorization: Bearer` matching `CRON_SECRET`). **Vercel Cron only fires daily on the Hobby plan**, which isn't frequent enough for a 35/hr drip — so this app relies on an external free pinger (e.g. cron-job.org) hitting that endpoint about once a minute. Each tick claims one due row at a time (`claimDueEmails`, `FOR UPDATE SKIP LOCKED` so overlapping ticks can't double-send — `BATCH_SIZE = 1` deliberately, since a multi-email batch risks the invocation running long enough to hit `maxDuration` mid-batch, wasting an already-reserved rate-limit slot with no result ever recorded for it), checks the shared rate limiter, sends via `sendMailDirect()`, and records the result — a row that can't get a rate-limit slot is released back to `pending` and retried on a later tick rather than dropped, so `scheduled_at` is a pacing target, not a hard deadline. Two consecutive failures auto-pauses the campaign (`MAX_CONSECUTIVE_SEND_FAILURES` in `lib/store.ts`) rather than burning through the rest of the list — `resumeCampaign()`/`POST /api/campaigns/:id/resume` un-pauses it in place (its pending rows were never touched, so no rescheduling needed, unlike `restartCampaign()` above). The browser side only ever needs the campaign `id` (kept in `localStorage`) to poll `GET /api/campaigns/:id` for progress; the send loop itself has no dependency on any browser being open.

### Tailwind v4 theme gotcha (`app/globals.css`)

The custom `@theme inline` block defines named spacing tokens (`--spacing-xs/sm/md/lg/xl`, used via `gap-md`, `p-lg`, etc.) and text tokens (`--text-headline-lg`, etc.). Tailwind v4 resolves named `max-w-*`/`w-*`/etc. utilities through the `--spacing-*` scale *before* falling back to its built-in `--container-*` scale — so because this theme defines `--spacing-sm`/`--spacing-md`, classes like `max-w-sm`/`max-w-md` silently resolve to those tiny spacing values (8px/16px) instead of Tailwind's real container sizes (24rem/28rem), rendering as near-invisible boxes. Use arbitrary values (`max-w-[24rem]`) instead of any named `max-w-*`/`w-*`/`h-*` size that collides with the xs/sm/md/lg/xl spacing scale.
