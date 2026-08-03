import { buildEmailHtml, LOGO_CID } from "./email-signature";
import type { DraftResult, OutreachConfig, RateLimitStatus, SendResult } from "./store";

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
      throw new SendRateLimitedError(
        data.error || "Send rate limit exceeded",
        data.rateLimit?.retryAfterSeconds ?? 60
      );
    }
    if (!res.ok) {
      return { email: draft.email, status: "failed", error: data.error || `HTTP ${res.status}` };
    }
    return { email: draft.email, status: "sent" };
  } catch (err) {
    if (err instanceof SendRateLimitedError) {
      throw err;
    }
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

export async function getSendRateStatus(): Promise<RateLimitStatus> {
  const res = await fetch("/api/send-email", { method: "GET" });
  if (!res.ok) {
    throw new Error(`Failed to fetch rate limit status: ${res.status}`);
  }
  return res.json();
}

// Sends one at a time with a randomized gap between sends, to avoid looking
// like a bot blast to Zoho's abuse detection. shouldCancel is checked
// between sends so a "Stop" button can halt mid-run without losing results
// already recorded via onResult.
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
    }
    if (i < drafts.length - 1 && !shouldCancel()) {
      await new Promise((r) => setTimeout(r, randomDelayMs(minDelayMs, maxDelayMs)));
    }
  }
}

