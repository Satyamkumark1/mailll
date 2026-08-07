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

`.env.local` (gitignored) needs `NEXT_PUBLIC_GROQ_API_KEY` and `EMAIL_USER`/`EMAIL_PASSWORD`/`EMAIL_HOST`/`EMAIL_PORT` (SMTP send credentials). Optional, for deep email verification off Vercel: `ABSTRACT_API_KEY`, `VERIFIER_SERVICE_URL`, `VERIFIER_SHARED_SECRET` — see "Deep verification" below.

## Architecture

### One page, six sequential stages

Almost the entire app lives in one client component, `app/validator/page.tsx`, which renders one of six stages based on `activeTab` in the Zustand store: **Upload → Validate → Results → Draft → Send → Export**. Stage metadata (labels/icons/descriptions) is centralized in `lib/tabs.ts`. `tabEnabled()` in the page gates which stages are reachable (e.g. Draft requires `validContacts.length > 0`, derived from `results`).

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

Drafts are plain text everywhere in the app (editor, CSV/TXT export, copy-to-clipboard). Only at actual send time does `buildEmailHtml()` convert the plain body to HTML and append a styled signature — the plain-text `config.signature` is stripped off the end (exact string match) before the styled HTML version replaces it. The logo is embedded via a CID attachment (`LOGO_CID`), attached server-side in `app/api/send-email/route.ts` from `public/elevique-logo.png` — deliberately not a remote `<img src>` URL, since mail clients commonly block remote images by default.

### Sending (`lib/email-sender.ts` + `app/api/send-email/route.ts`)

`sendDraftsPaced()` sends one at a time with a randomized delay between sends (to avoid looking like a bot blast to spam filters), checking a `shouldCancel()` callback between sends so a "Stop" button can halt mid-run without losing already-recorded results. The route sends via `nodemailer` against `EMAIL_HOST`/`EMAIL_USER`/`EMAIL_PASSWORD` (defaults to Hostinger on port 465), passing both `text` and `html` as a multipart message.

### Tailwind v4 theme gotcha (`app/globals.css`)

The custom `@theme inline` block defines named spacing tokens (`--spacing-xs/sm/md/lg/xl`, used via `gap-md`, `p-lg`, etc.) and text tokens (`--text-headline-lg`, etc.). Tailwind v4 resolves named `max-w-*`/`w-*`/etc. utilities through the `--spacing-*` scale *before* falling back to its built-in `--container-*` scale — so because this theme defines `--spacing-sm`/`--spacing-md`, classes like `max-w-sm`/`max-w-md` silently resolve to those tiny spacing values (8px/16px) instead of Tailwind's real container sizes (24rem/28rem), rendering as near-invisible boxes. Use arbitrary values (`max-w-[24rem]`) instead of any named `max-w-*`/`w-*`/`h-*` size that collides with the xs/sm/md/lg/xl spacing scale.
