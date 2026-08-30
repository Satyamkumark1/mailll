// Pure math for the send-cap warm-up ramp — no DB access, safe to import
// from both server code (lib/sender-accounts.ts) and tests. Follows Zoho's
// own documented guidance (ramp volume up gradually rather than jumping to
// a flat cap) after the account got blocked for bursty test sending — see
// https://www.zoho.com/mail/help/adminconsole/rates-and-limits.html.

export const DEFAULT_RAMP_DAYS = 14;

// Linearly ramps from `floor` up to `targetCap` over `rampDays`, reaching
// `targetCap` exactly once `daysElapsed >= rampDays`. If `targetCap` is
// already at or below `floor`, there's nothing to ramp — just return it.
export function computeWarmupCap(
  targetCap: number,
  floor: number,
  daysElapsed: number,
  rampDays: number = DEFAULT_RAMP_DAYS
): number {
  if (targetCap <= floor) return targetCap;
  if (daysElapsed >= rampDays) return targetCap;
  const progress = Math.max(0, daysElapsed) / rampDays;
  return Math.round(floor + (targetCap - floor) * progress);
}
