# Email Validator Pro

Validate a contact list, draft personalized AI outreach, and send it — in one pipeline, without stitching together a separate validator, copywriting tool, and mail sender.

Upload a CSV → clean it with real MX/SMTP mailbox checks (not just format regex) → generate a personalized subject + body per valid contact → schedule a paced background campaign from your own SMTP account → export everything at any stage.

## How it works

The app is a single seven-stage pipeline:

| Stage | What happens |
| --- | --- |
| **1. Upload** | Drop in a CSV of contacts. Columns are auto-detected (email, brand, category, LinkedIn URL, POC name/designation) — any header naming works, and a missing-email/duplicate row is skipped and counted, not silently dropped. |
| **2. Validate** | Every row runs through three layers: local heuristics (format, disposable-domain list, spam-trap and role-based patterns) → live MX + SMTP mailbox check with catch-all detection → a Groq AI pass that confirms or overturns the combined verdict. Can be skipped entirely if you'd rather trust your list as-is. |
| **3. Results** | Filter by valid/invalid/flagged, search, bulk-approve flagged or invalid rows, override any single verdict, export as CSV. |
| **4. Draft** | Groq writes a personalized subject + opening hook per valid contact from your pitch, proof points, CTA, and tone — or supply your own hook text to skip AI generation entirely and use the exact same line for everyone. Review and edit each draft in a focused per-recipient editor before sending. |
| **5. Send** | Schedule a background campaign — pick "start now" or a specific future time, a duration to spread sends across, and optionally exclude specific recipients first — that keeps sending server-side even if you close the browser. Outgoing mail includes a styled HTML signature (with your logo) alongside the plain-text version. |
| **6. Export** | Download validation results (full or valid-only) and generated drafts (CSV or a single readable text file) at any point. |
| **7. History** | Every background campaign ever scheduled, read fresh from the server — so you can check outcomes (including failures) even if you never reopen the tab that started one. |

### The validation pipeline in more detail

Deep mailbox verification means actually speaking SMTP to the recipient's mail server (`MAIL FROM` / `RCPT TO`, reading the real accept/reject code) — not just checking that an MX record exists. It also probes a couple of random addresses at the same domain to detect catch-all servers, which can't give a trustworthy per-mailbox answer.

**Vercel blocks outbound port 25**, which this kind of check needs, so the app picks one of three verification backends at request time:

1. **Abstract API** (if `ABSTRACT_API_KEY` is set) — an external HTTPS verification service, no infra required.
2. **A self-hosted verifier service** (if `VERIFIER_SERVICE_URL` is set) — a small standalone Node service (`verifier-service/`) you deploy to a VPS where port 25 isn't blocked. See `verifier-service/deploy.sh` for a scripted Ubuntu/Debian setup (Node, pm2, Caddy for HTTPS).
3. **In-process** (if neither is set) — runs the same SMTP check directly in the Next.js server. Works locally, where port 25 is often open; won't work once deployed to Vercel.

## Getting started

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

### Environment variables

Create `.env.local` in the project root:

| Variable | Required | Purpose |
| --- | --- | --- |
| `NEXT_PUBLIC_GROQ_API_KEY` | Yes | Groq API key — powers the AI validation pass and AI-drafted hooks. |
| `DATABASE_URL` | Yes (to send) | Postgres connection string. Backs the send-rate limiter, sender settings, and background send campaigns. |
| `SETTINGS_ENCRYPTION_KEY` | Yes (to send) | 32-byte hex key encrypting the SMTP password stored via the Settings modal. Generate with `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`. |
| `CRON_SECRET` | Only for background campaigns | Shared secret required by `/api/cron/tick`. |
| `ABSTRACT_API_KEY` | No | Enables deep mailbox verification via Abstract API instead of raw SMTP. |
| `VERIFIER_SERVICE_URL` | No | URL of a self-hosted `verifier-service/` instance, for deep verification when deployed somewhere that blocks port 25. |
| `VERIFIER_SHARED_SECRET` | No | Bearer token securing requests to `VERIFIER_SERVICE_URL`. |
| `EMAIL_USER`/`EMAIL_PASSWORD`/`EMAIL_HOST`/`EMAIL_PORT`/`EMAIL_HOURLY_CAP`/`EMAIL_DAILY_CAP` | No (legacy) | Only read once, to seed the database the first time sender settings are loaded with no configuration saved yet. The Settings modal (gear icon, top right) is the source of truth after that — see below. |

Without a Groq key, validation and AI-drafted hooks won't run — but you can still generate drafts by supplying your own custom hook text, which skips the AI call entirely.

Without `ABSTRACT_API_KEY` or `VERIFIER_SERVICE_URL`, deep mailbox verification runs in-process — fine locally, but it will silently fall back to heuristic-only results once deployed to a platform that blocks port 25 (Vercel included).

## Sender settings and send limits (Settings modal)

Click the gear icon (top right) to configure the sending account (SMTP host/port/user/password) and hourly/daily send caps — no env vars or redeploys needed. Two guardrails are built in, based on [Zoho's own documented sending limits](https://www.zoho.com/mail/help/adminconsole/rates-and-limits.html) (external sending is reputation-based, dynamically capped at 50-500/hr):

- An hourly cap above **500** is rejected outright — that's Zoho's documented absolute ceiling regardless of reputation.
- An hourly cap above **50** is accepted but flagged with a warning — safe for an account with an established sending history, risky otherwise.
- **Warm-up**: when enabled (the default), actual sending starts well below your configured caps and ramps up to them over ~14 days, rather than sending at full volume from day one — this follows Zoho's own advice to ramp volume up gradually instead of bursting, which is exactly what triggers an "Unusual sending activity detected" block. Use **Reset warm-up** in the modal to restart the ramp from the floor after a block clears.

## Background send campaigns (survive closing the browser)

Sending only happens through scheduled background campaigns — choose to start now or at a specific future time, pick a total duration (e.g. "send 400 emails over 12 hours"), and the sends keep going on the server, still capped by whatever limits are set in Settings, until done — you can close the tab or shut your laptop, even before the scheduled start time arrives. (An earlier "send now, keep the tab open" mode was removed — it shared the same send-rate budget as background campaigns with no way to prioritize between them, so a stray immediate send could silently starve a running campaign.)

This needs two one-time setup steps, since Vercel's free (Hobby) plan can't run its own cron more than once a day:

1. **Add a Postgres database** — the easiest way is the [Neon](https://neon.tech) integration from the Vercel Marketplace (Storage tab in your Vercel project), which sets `DATABASE_URL` for you. Then run [`lib/schema.sql`](lib/schema.sql) once via the Neon SQL console to create the required tables.
2. **Register an external cron** — generate a random string for `CRON_SECRET` and set it in your environment, then point a free service like [cron-job.org](https://cron-job.org) at `https://<your-app>.vercel.app/api/cron/tick?secret=<CRON_SECRET>` on a 1-minute interval. This is what actually drives sending — nothing sends without it running.

Once both are set, "Schedule background campaign" appears usable in the Send stage.

## Commands

- `npm run dev` — start the dev server (Turbopack) at localhost:3000
- `npm run build` — production build
- `npm run start` — run a production build
- `npm run lint` — ESLint
- `npm test` — run the test suite (`node --test`, picks up `lib/__tests__/*.test.ts`)
- `npm run build:verifier` — compile the standalone `verifier-service/` (its own `tsconfig.json`, separate from the Next.js app)
- `npm run start:verifier` — run the built verifier service

## Deploying the self-hosted verifier service

Only needed if you want real MX/SMTP verification in production without paying for Abstract API. On a fresh Ubuntu/Debian VPS:

```bash
git clone <your-repo-url> email-validator && cd email-validator
sudo bash verifier-service/deploy.sh verifier.yourdomain.com
```

This installs Node/pm2/Caddy, builds and starts the verifier under pm2 (survives reboots), and puts it behind HTTPS via Caddy. You'll still need to point the domain's DNS at the box, set its PTR/rDNS record, and ask the provider to unblock outbound port 25 — the script prints exactly what's left once it finishes, along with the `VERIFIER_SERVICE_URL` / `VERIFIER_SHARED_SECRET` values to set in Vercel.

## Tech stack

Next.js 16 (App Router, Turbopack) · React 19 · TypeScript · Tailwind CSS v4 · Zustand (client state, no persistence — a refresh clears the pipeline by design; the one exception is an active background campaign's id, kept in `localStorage` so its progress panel survives a refresh) · Postgres (Neon) for the send-rate limiter and background campaigns · Groq (Llama 3.1) for AI validation and drafting · Nodemailer for sending · Papaparse for CSV parsing.
## Deploying

Deploy the Next.js app to [Vercel](https://vercel.com) as usual, with the environment variables above set in the project settings. Deploy `verifier-service/` separately (see above) only if you need deep verification without Abstract API.
