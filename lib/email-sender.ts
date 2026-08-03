import { buildEmailHtml, LOGO_CID } from "./email-signature";
import type { DraftResult, OutreachConfig, SendResult } from "./store";
import type { RateLimitStatus } from "./send-rate-limiter";

export class SendRateLimitedError extends Error {
  retryAfterSeconds: number;

  constructor(message: string, retryAfterSeconds: number) {
    super(message);
    this.name = "SendRateLimitedError";
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

async function sendOne(draft: DraftResult, config: OutreachConfig): Promise<SendResult> {
  try {
    const html = buildEmailHtml(config, draft.body, `cid:${LOGO_CID}`);
    const res = await fetch("/api/send-email", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ to: draft.email, subject: draft.subject, body: draft.body, html }),
    });
    const data = await res.json();
    if (res.status === 429) {
      throw new SendRateLimitedError(data.error || "Send limit reached", data.rateLimit?.retryAfterSeconds ?? 0);
    }
    if (!res.ok) {
      return { email: draft.email, status: "failed", error: data.error || `HTTP ${res.status}` };
    }
    return { email: draft.email, status: "sent" };
  } catch (err) {
    if (err instanceof SendRateLimitedError) throw err;
    return {
      email: draft.email,
      status: "failed",
      error: err instanceof Error ? err.message : "Network error",
    };
  }
}

function randomDelayMs(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

// Reads the pre-flight rate-limit status without attempting a send.
export async function getSendRateStatus(): Promise<RateLimitStatus> {
  const res = await fetch("/api/send-email", { method: "GET" });
  return res.json();
}

// Sends one at a time with a randomized gap between sends, to avoid looking
// like a bot blast to Zoho's abuse detection. shouldCancel is checked
// between sends so a "Stop" button can halt mid-run without losing results
// already recorded via onResult. If the server reports the hourly/daily cap
// has been reached, the run stops immediately via onRateLimited instead of
// burning through the remaining drafts as one-by-one failures.
export async function sendDraftsPaced(
  drafts: DraftResult[],
  config: OutreachConfig,
  minDelayMs: number,
  maxDelayMs: number,
  onProgress: (done: number, total: number) => void,
  onResult: (result: SendResult) => void,
  shouldCancel: () => boolean,
  onRateLimited?: (message: string, retryAfterSeconds: number) => void
): Promise<void> {
  for (let i = 0; i < drafts.length; i++) {
    if (shouldCancel()) return;
    try {
      const result = await sendOne(drafts[i], config);
      onResult(result);
      onProgress(i + 1, drafts.length);
    } catch (err) {
      if (err instanceof SendRateLimitedError) {
        onRateLimited?.(err.message, err.retryAfterSeconds);
        return;
      }
      throw err;
    }
    if (i < drafts.length - 1 && !shouldCancel()) {
      await new Promise((r) => setTimeout(r, randomDelayMs(minDelayMs, maxDelayMs)));
    }
  }
}
