# Master Prompt — Email Validator Pro Redesign

## Product

**Email Validator Pro** is a tool that cleans a contact list (CSV upload), validates each address through a real pipeline (local format/disposable-domain heuristics → live MX + SMTP mailbox + catch-all check → AI review of anything ambiguous), then lets the user generate a personalized AI-written outreach email per valid contact and send it, paced, from their own Gmail account. It's validation + AI-drafted outreach + sending in one tool — not just a list-cleaning service like ZeroBounce/NeverBounce, and not a mass-mailing blast tool either.

Audience: marketers, founders, and outreach/growth people sending cold or warm outreach who want to stop bouncing emails and skip juggling a separate validator + copywriting + sending tool.

## Design direction

**Current UI is too plain/flat-corporate and needs to feel more alive.** Reference points: **Framer, Notion, Raycast** — bold color, real motion, a bit of illustration/personality, confident typography. Not another blue-gradient-cards-on-white AI SaaS template. It should feel crafted, not generated.

Concretely:
- Pick one confident accent color (or a duo) and commit to it — don't default to generic SaaS blue unless it earns its place with something distinctive (a gradient treatment, a duotone, an unusual shade).
- Real motion: hover states, scroll-triggered reveals, a hero visual that moves or reacts, transitions between states — not just fades.
- Typography with a point of view — a strong display face for headlines is welcome, doesn't need to be a generic geometric sans.
- Some illustration or custom iconography for the hero and section dividers, not just Material Symbols glyphs in circles.
- Dark mode is required (the product currently supports OS-level `prefers-color-scheme` — a toggle is fine too) and should feel like an intentional second theme, not an inverted afterthought.
- It's fine to depart entirely from the current visual system (colors, type, spacing) — this is a from-scratch redesign, not a refresh. Keep the content and structure below, not the current styling.

## What to avoid

- No invented stats, customer logos, testimonials, or "trusted by X companies" — this product has no user-count data, and fabricated social proof would undercut the whole credibility pitch. Design credibility through clarity, real feature detail, and craft — not fake numbers.
- No generic dashboard-with-sidebar cliché for the sake of it — reimagine the tool's workspace if you have a better idea for how six sequential stages should feel, as long as the six stages and their function stay intact.

## Screens to design

### 1. Marketing landing page (`/`)

**Nav** — logo/wordmark, in-page links (How it works / Features / Compare / FAQ), primary CTA "Launch App".

**Hero**
- Eyebrow: "Validation + AI outreach, one pipeline"
- Headline: "Stop guessing which emails are real."
- Subhead: "Local heuristics catch the obvious junk instantly. Live MX and SMTP checks confirm the mailbox actually exists. Groq AI reviews anything still ambiguous — then writes and sends your outreach. Validate, draft, and send, without leaving one tool."
- Primary CTA: "Get Started — it's free to run", secondary: "See how it works"
- A visual — currently a static results-list preview (3 rows: valid/flagged/invalid). Feel free to reimagine this as something more dynamic/illustrated, as long as it's captioned as illustrative, not real usage data.

**How it works — six stages** (use these labels/descriptions verbatim as the content, restyle freely):
1. **Upload** — Drop in a CSV of contacts — any columns, we auto-detect the email field.
2. **Validate** — Local heuristics catch the obvious junk instantly, then live MX + SMTP + catch-all checks, then a Groq AI pass on anything still ambiguous.
3. **Results** — Filter by status, search by brand or name, and manually override any verdict.
4. **Draft** — Groq writes a personalized subject + body per valid contact from your pitch and tone.
5. **Send** — Paced sending straight from your own Gmail account — cancel mid-run anytime.
6. **Export** — Download the full results, valid-only list, or generated drafts as CSV.

**Feature grid** (8 items, real capabilities — keep factual, restyle freely):
- Local heuristic pre-filter — format, disposable-domain, and role-account checks run instantly, before anything touches the network.
- Live MX + SMTP mailbox check — confirms the mailbox itself accepts mail, not just that the domain has a mail server.
- Catch-all detection — flags servers whose accept/reject answers can't be trusted, instead of guessing at a verdict.
- AI review of ambiguous cases — Groq confirms or overturns the heuristic verdict, with automatic retry on rate limits.
- AI-drafted outreach — a personalized subject + body per contact, written from your pitch, proof points, CTA, and tone.
- Paced sending, your own Gmail — randomized delay between sends, cancel mid-run, CAN-SPAM footer included automatically.
- Manual override on any row — disagree with a verdict? "Mark valid" gives you the final say, always.
- Export at every stage — full results, valid-only, or generated drafts, download as CSV whenever you need to.

**Comparison table** — capability rows vs. two competitor categories (not specific companies' internals):

| Capability | Email Validator Pro | Dedicated validators (ZeroBounce, NeverBounce) | Mass-mailing tools |
|---|---|---|---|
| Local heuristic pre-filter | ✓ | ✓ | Varies |
| Live MX + SMTP mailbox check | ✓ | ✓ | ✗ |
| Catch-all / inconsistent-response detection | ✓ | ✓ | ✗ |
| AI-assisted review of ambiguous cases | ✓ | Not typical | ✗ |
| Personalized AI-drafted outreach per contact | ✓ | ✗ | Varies (template/merge-tag) |
| Paced sending from your own Gmail account | ✓ | ✗ | Varies (own sending infra) |
| Requires uploading your list to a third-party hosted dashboard | ✗ | ✓ | ✓ |

**Trust & security** — "No database, no dashboard, no lock-in." Three points: (1) your list lives only in the browser session, clears on refresh; (2) individual addresses go to Groq (AI) and this app's own server (MX/SMTP) — never a separate storage/analytics service; (3) sending uses your own Gmail credentials, set server-side, never handed to a third party.

**FAQ** (6 items — keep content, restyle freely): CSV-only upload; no data storage explanation; Groq-unavailable fallback behavior; Gmail-flagging/pacing explanation; manual override; what credentials are needed (Groq key, Gmail + app password).

**Footer** — wordmark, one-line tagline, final CTA, copyright.

### 2. The tool itself (`/validator`) — six workspace screens

A workspace shell (header + some form of stage navigation + content area) containing six stage views. Current implementation uses a persistent left sidebar listing all six stages with completion checkmarks, but the navigation pattern is open to reinvention as long as: users can see all six stages and their status at a glance, jump between completed/available stages, and see a live progress indicator during validation/sending.

1. **Upload** — CSV dropzone (drag-and-drop + browse), a "quick single-email check" (paste one address, runs it through the full pipeline without a CSV), and post-upload stats (total rows / skipped-missing / skipped-duplicate).
2. **Validate** — shows contact count, a progress bar during the live validation run, and a "Start Validation" action.
3. **Results** — a data table (Brand, Category, POC Name, Designation, LinkedIn, Email, Status badge, Reason, a "Mark valid" override action per row), filters (all/valid/invalid/flagged), search, CSV download.
4. **Draft** — a form (sender name, company, pitch, proof points, CTA, signature, business address, tone picker) plus a "Generate Drafts" action; generated drafts list with per-draft copy-to-clipboard.
5. **Send** — pacing presets (Cautious/Balanced/Fast, each with a risk note), send progress, cancel action, per-recipient send-result table (sent/failed).
6. **Export** — download buttons for full results / valid-only / drafts CSV.

## Technical handoff notes

Eventually rebuilt in Next.js 16 (App Router) + Tailwind CSS v4 + Framer Motion, React 19. If your output can be expressed as reusable components (buttons, badges, cards, a data table, a stepper/nav) rather than one-off compositions, that's easier to hand off to code — but don't let that constrain the creative direction.

## Deliverables

Both screens above (landing page, full scroll; tool workspace, all six stage states) in light and dark, at desktop width. Mobile treatment for the landing page is a bonus, not required for the first pass.
