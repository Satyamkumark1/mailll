// Pure scheduling math for background send campaigns — no DB/network
// access, safe to import from both server code (lib/campaigns.ts) and the
// client (app/validator/page.tsx, to compute/display the minimum duration
// before submitting). Keep it that way; put anything that touches
// Postgres in lib/campaigns.ts instead.

// Roughly matches the "cautious" preset gap used by the immediate
// (browser-driven) sender in lib/email-sender.ts — the floor below which
// sends would start looking like a bot blast rather than a human pace.
const MIN_PACE_GAP_SEC = 30;

// The smallest duration (in hours, can be fractional) worth recommending
// for `count` emails: enough to keep a human-ish gap between sends, and
// enough that the whole batch doesn't front-load into a single rolling
// hour above the cap. This is a UX floor, not the actual safety net — the
// DB-backed rate limiter (lib/send-rate-limiter.ts) is what actually
// enforces the cap regardless of what duration was requested.
export function computeMinDurationHours(count: number, hourlyCap: number): number {
  if (count <= 0) return 0;
  const paceHours = (count * MIN_PACE_GAP_SEC) / 3600;
  const capHours = count / hourlyCap;
  return Math.max(paceHours, capHours);
}

// Renders a fractional-hours duration as a short human string, e.g. "3
// minutes" or "11.5 hours" — used both server-side (validation error
// message) and client-side (the duration input's helper text).
export function formatDurationHours(hours: number): string {
  if (hours < 1) {
    const minutes = Math.max(1, Math.ceil(hours * 60));
    return `${minutes} minute${minutes === 1 ? "" : "s"}`;
  }
  const rounded = Math.ceil(hours * 10) / 10;
  return `${rounded} hour${rounded === 1 ? "" : "s"}`;
}

// Evenly spaces `count` timestamps across [windowStart, windowEnd] with
// jitter of up to +/-20% of the interval, clamped inside the window so
// sending doesn't look perfectly robotic but still respects the chosen
// duration. Pure function — see lib/__tests__/campaign-schedule.test.ts.
export function computeScheduledTimes(count: number, windowStart: Date, windowEnd: Date): Date[] {
  if (count <= 0) return [];
  const startMs = windowStart.getTime();
  const endMs = windowEnd.getTime();
  const span = Math.max(0, endMs - startMs);
  const interval = count > 1 ? span / count : span / 2;
  const jitterRange = interval * 0.2;

  const times: Date[] = [];
  for (let i = 0; i < count; i++) {
    const base = startMs + interval * (i + 0.5);
    const jitter = (Math.random() * 2 - 1) * jitterRange;
    const clamped = Math.min(endMs, Math.max(startMs, base + jitter));
    times.push(new Date(clamped));
  }
  // Jitter can't invert order given interval-sized slots and a 20% jitter cap,
  // but sort defensively since callers rely on scheduled_at ordering.
  times.sort((a, b) => a.getTime() - b.getTime());
  return times;
}
