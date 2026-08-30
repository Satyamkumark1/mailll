import { sql, sqlTransaction } from "./db.ts";
import { getEffectiveRateLimitConfig, listAccounts, type SenderAccount } from "./sender-accounts.ts";

export interface RateLimitConfig {
  hourlyCap: number;
  dailyCap: number;
}

export interface WindowStatus {
  used: number;
  cap: number;
  remaining: number;
}

export interface RateLimitStatus {
  allowed: boolean;
  hourly: WindowStatus;
  daily: WindowStatus;
  retryAfterSeconds: number; // 0 when allowed
  // Only populated by peek/reserve helpers below (not by the pure
  // computeRateLimitStatus) — which of "immediate" (legacy) vs "campaign"
  // (background campaigns) is actually consuming the trailing-hour window
  // right now, so a stall is diagnosable from the UI without a DB query.
  hourlySourceBreakdown?: Record<string, number>;
}

const HOURLY_MS = 3600000;
const DAILY_MS = 86400000;

export function computeRateLimitStatus(
  attempts: number[],
  config: RateLimitConfig,
  now: number
): RateLimitStatus {
  const hourlyAttempts = attempts.filter((t) => t > now - HOURLY_MS);
  const dailyAttempts = attempts.filter((t) => t > now - DAILY_MS);

  const hourlyUsed = hourlyAttempts.length;
  const dailyUsed = dailyAttempts.length;

  const hourlyRemaining = Math.max(0, config.hourlyCap - hourlyUsed);
  const dailyRemaining = Math.max(0, config.dailyCap - dailyUsed);

  const hourlyBlocked = hourlyUsed >= config.hourlyCap;
  const dailyBlocked = dailyUsed >= config.dailyCap;
  const allowed = !hourlyBlocked && !dailyBlocked;

  let retryAfterSeconds = 0;

  if (!allowed) {
    let hourlyRetry = 0;
    let dailyRetry = 0;

    if (hourlyBlocked && hourlyAttempts.length > 0) {
      const oldestHourly = Math.min(...hourlyAttempts);
      const msUntilExpiry = oldestHourly + HOURLY_MS - now;
      hourlyRetry = Math.max(1, Math.ceil(msUntilExpiry / 1000));
    }

    if (dailyBlocked && dailyAttempts.length > 0) {
      const oldestDaily = Math.min(...dailyAttempts);
      const msUntilExpiry = oldestDaily + DAILY_MS - now;
      dailyRetry = Math.max(1, Math.ceil(msUntilExpiry / 1000));
    }

    retryAfterSeconds = Math.max(hourlyRetry, dailyRetry);
  }

  return {
    allowed,
    hourly: {
      used: hourlyUsed,
      cap: config.hourlyCap,
      remaining: hourlyRemaining,
    },
    daily: {
      used: dailyUsed,
      cap: config.dailyCap,
      remaining: dailyRemaining,
    },
    retryAfterSeconds,
  };
}

const SOURCE_LABELS: Record<string, string> = {
  campaign: "background campaigns",
  immediate: "immediate sends",
};

// Only worth showing once there are 2+ distinct sources — otherwise it's
// just repeating the same total a second time.
export function formatSourceBreakdown(breakdown: Record<string, number> | undefined): string {
  if (!breakdown || Object.keys(breakdown).length < 2) return "";
  return Object.entries(breakdown)
    .filter(([, n]) => n > 0)
    .sort((a, b) => b[1] - a[1])
    .map(([source, n]) => `${n} from ${SOURCE_LABELS[source] ?? source}`)
    .join(", ");
}

// Human-readable description of whichever cap(s) are currently blocking a
// send — used to explain a stalled campaign/send in the UI rather than
// leaving the user to guess why nothing is happening.
export function describeRateLimitBlock(status: RateLimitStatus): string {
  const hourlyBlocked = status.hourly.remaining === 0;
  const dailyBlocked = status.daily.remaining === 0;
  let base: string;
  if (hourlyBlocked && dailyBlocked) {
    base = `the hourly cap (${status.hourly.used}/${status.hourly.cap} this hour) and the daily cap (${status.daily.used}/${status.daily.cap} in the last 24h)`;
  } else if (dailyBlocked) {
    base = `the daily cap (${status.daily.used}/${status.daily.cap} sends in the last 24h)`;
  } else {
    base = `the hourly cap (${status.hourly.used}/${status.hourly.cap} sends this hour)`;
  }
  const breakdown = formatSourceBreakdown(status.hourlySourceBreakdown);
  return breakdown ? `${base} (${breakdown})` : base;
}

// Pure — deliberately a relative duration ("in about 45 min"), not an
// absolute clock time, so it can be computed directly during render without
// calling Date.now() (React's react-hooks/purity rule forbids impure calls
// like Date.now() in render, including inside useMemo/useEffect derivations).
export function formatRetryAfter(seconds: number): string {
  if (seconds < 60) return "less than a minute";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return remainingMinutes > 0 ? `${hours}h ${remainingMinutes}m` : `${hours}h`;
}

interface AttemptRecord {
  ts: number;
  source: string;
}

async function readAttempts(now: number, accountIds: number[]): Promise<AttemptRecord[]> {
  if (accountIds.length === 0) return [];
  try {
    const rows = await sql`
      SELECT extract(epoch from sent_at) * 1000 AS ts, source
      FROM send_attempts
      WHERE sent_at > to_timestamp(${(now - DAILY_MS) / 1000}) AND account_id = ANY(${accountIds}::int[])
    `;
    return rows.map((r) => ({ ts: Number(r.ts), source: (r.source as string) || "immediate" }));
  } catch (err) {
    console.warn("Failed to read send_attempts, failing open:", err);
    return [];
  }
}

function computeHourlySourceBreakdown(attempts: AttemptRecord[], now: number): Record<string, number> {
  const breakdown: Record<string, number> = {};
  for (const a of attempts) {
    if (a.ts > now - HOURLY_MS) {
      breakdown[a.source] = (breakdown[a.source] ?? 0) + 1;
    }
  }
  return breakdown;
}

// One account's current status against its own (warm-up-adjusted) caps —
// used by the cron tick to decide which accounts can currently send at all.
export async function peekAccountRateLimitStatus(account: SenderAccount, now = Date.now()): Promise<RateLimitStatus> {
  const attempts = await readAttempts(now, [account.id]);
  const config = getEffectiveRateLimitConfig(account);
  const status = computeRateLimitStatus(attempts.map((a) => a.ts), config, now);
  return { ...status, hourlySourceBreakdown: computeHourlySourceBreakdown(attempts, now) };
}

// Reserves one send slot against a specific account's shared cap — the live
// DB check here (not the cron tick's in-memory snapshot) is the sole
// authority on whether a send is actually allowed.
//
// Concurrent callers for the SAME account (two due emails both assigned to
// it within one tick, or two overlapping tick invocations) must not both
// squeeze through when only one slot remains — a plain read-then-insert
// has a TOCTOU race: both could read "1 remaining" before either commits.
// pg_advisory_xact_lock(account.id) closes that: the lock-acquire ->
// recompute -> conditional-insert sequence below runs as one non-interactive
// transaction (the Neon HTTP driver has no interactive/multi-round-trip
// transactions, so this can't be split into separate awaited round trips —
// everything that must share the lock has to be one sqlTransaction call), so
// a second caller's lock acquisition blocks until the first's transaction —
// insert included, if it made one — has committed and released the lock.
export async function reserveSendSlot(
  account: SenderAccount,
  source: "immediate" | "campaign",
  now = Date.now()
): Promise<RateLimitStatus> {
  const config = getEffectiveRateLimitConfig(account);

  const [, insertedRows, attemptRows] = await sqlTransaction([
    sql`SELECT pg_advisory_xact_lock(${account.id})`,
    sql`
      WITH counts AS (
        SELECT
          count(*) FILTER (WHERE sent_at > to_timestamp(${(now - HOURLY_MS) / 1000})) AS hourly_used,
          count(*) FILTER (WHERE sent_at > to_timestamp(${(now - DAILY_MS) / 1000})) AS daily_used
        FROM send_attempts
        WHERE account_id = ${account.id}
      )
      INSERT INTO send_attempts (sent_at, source, account_id)
      SELECT to_timestamp(${now / 1000}), ${source}, ${account.id}
      FROM counts
      -- Mirrors computeRateLimitStatus's allowed = !hourlyBlocked && !dailyBlocked
      -- (hourlyBlocked = hourlyUsed >= hourlyCap) — keep these in sync.
      WHERE counts.hourly_used < ${config.hourlyCap} AND counts.daily_used < ${config.dailyCap}
      RETURNING 1
    `,
    sql`
      SELECT extract(epoch from sent_at) * 1000 AS ts, source
      FROM send_attempts
      WHERE account_id = ${account.id} AND sent_at > to_timestamp(${(now - DAILY_MS) / 1000})
    `,
  ]);

  const reserved = insertedRows.length > 0;
  const attempts: AttemptRecord[] = attemptRows.map((r) => ({ ts: Number(r.ts), source: (r.source as string) || "immediate" }));
  const status = computeRateLimitStatus(attempts.map((a) => a.ts), config, now);

  if (reserved) {
    return { ...status, allowed: true, hourlySourceBreakdown: computeHourlySourceBreakdown(attempts, now) };
  }
  return { ...status, hourlySourceBreakdown: computeHourlySourceBreakdown(attempts, now) };
}

async function activeAccountsWithAggregateConfig(): Promise<{ accounts: SenderAccount[]; config: RateLimitConfig }> {
  const accounts = (await listAccounts()).filter((a) => a.status === "active");
  const config = accounts.reduce(
    (sum, a) => {
      const eff = getEffectiveRateLimitConfig(a);
      return { hourlyCap: sum.hourlyCap + eff.hourlyCap, dailyCap: sum.dailyCap + eff.dailyCap };
    },
    { hourlyCap: 0, dailyCap: 0 }
  );
  return { accounts, config };
}

// Combined cap across every active account — used for campaign-duration
// validation (lib/campaign-schedule.ts's computeMinDurationHours doesn't
// care whose cap it's given, just the number).
export async function getRateLimitConfig(): Promise<RateLimitConfig> {
  return (await activeAccountsWithAggregateConfig()).config;
}

// Combined status across every active account — what the Send/History UI
// displays. Not itself used to gate any individual send (each account's own
// reserveSendSlot call is what actually enforces its cap).
export async function peekRateLimitStatus(now = Date.now()): Promise<RateLimitStatus> {
  const { accounts, config } = await activeAccountsWithAggregateConfig();
  const attempts = await readAttempts(now, accounts.map((a) => a.id));
  const status = computeRateLimitStatus(attempts.map((a) => a.ts), config, now);
  return { ...status, hourlySourceBreakdown: computeHourlySourceBreakdown(attempts, now) };
}

export interface AccountLoad {
  accountId: number;
  hourlyUsed: number;
  hourlyCap: number;
  dailyUsed: number;
  dailyCap: number;
}

// Picks whichever candidate is currently furthest from its own cap, by
// fraction used rather than raw count — otherwise an account with a smaller
// configured cap would always look "more loaded" than one with a bigger
// cap purely because its numbers are smaller. Returns null for an empty list.
export function pickLeastLoadedAccount(candidates: AccountLoad[]): number | null {
  if (candidates.length === 0) return null;
  let best = candidates[0];
  let bestLoad = Math.max(best.hourlyUsed / best.hourlyCap, best.dailyUsed / best.dailyCap);
  for (const c of candidates.slice(1)) {
    const load = Math.max(c.hourlyUsed / c.hourlyCap, c.dailyUsed / c.dailyCap);
    if (load < bestLoad) {
      best = c;
      bestLoad = load;
    }
  }
  return best.accountId;
}
