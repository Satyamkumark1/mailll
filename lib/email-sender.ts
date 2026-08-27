import type { RateLimitStatus } from "./store.ts";

export async function getSendRateStatus(): Promise<RateLimitStatus> {
  const res = await fetch("/api/send-email", { method: "GET" });
  if (!res.ok) {
    throw new Error(`Failed to fetch rate limit status: ${res.status}`);
  }
  return res.json();
}
