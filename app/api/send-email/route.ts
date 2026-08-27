import { peekRateLimitStatus } from "@/lib/send-rate-limiter";

export const runtime = "nodejs";

// Immediate ("Send now") sending was removed — it shared the same send-rate
// budget as background campaigns with no way to prioritize between them, so
// a stray immediate send could silently starve a running campaign. This
// route now only exposes the shared rate-limit status for display (Send and
// History pages poll it via lib/email-sender.ts's getSendRateStatus());
// actual sending happens exclusively through background campaigns
// (app/api/cron/tick).
export async function GET() {
  return Response.json(await peekRateLimitStatus());
}
