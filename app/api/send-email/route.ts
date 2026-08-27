import { sendMailDirect } from "@/lib/send-mail";
import { peekRateLimitStatus, reserveSendSlot } from "@/lib/send-rate-limiter";
import { getSenderSettings } from "@/lib/sender-settings";

export const runtime = "nodejs";

export async function GET() {
  return Response.json(await peekRateLimitStatus());
}

export async function POST(request: Request) {
  const { to, subject, body, html } = await request.json();
  if (!to || !subject || !body) {
    return Response.json({ error: "Missing to/subject/body" }, { status: 400 });
  }

  const settings = await getSenderSettings();
  if (!settings) {
    return Response.json({ error: "No sender account configured yet — set one up in Settings." }, { status: 500 });
  }

  const rateLimit = await reserveSendSlot("immediate");
  if (!rateLimit.allowed) {
    let errorMsg = `Send rate limit exceeded. Retry after ${rateLimit.retryAfterSeconds} seconds.`;
    if (rateLimit.hourly.used >= rateLimit.hourly.cap) {
      errorMsg = `Hourly send limit reached (${rateLimit.hourly.used}/${rateLimit.hourly.cap}).`;
    } else if (rateLimit.daily.used >= rateLimit.daily.cap) {
      errorMsg = `Daily send limit reached (${rateLimit.daily.used}/${rateLimit.daily.cap}).`;
    }

    return Response.json(
      {
        error: errorMsg,
        code: "RATE_LIMIT_EXCEEDED",
        rateLimit,
      },
      {
        status: 429,
        headers: {
          "Retry-After": String(rateLimit.retryAfterSeconds),
        },
      }
    );
  }

  try {
    await sendMailDirect({ to, subject, text: body, html });
    return Response.json({ success: true, rateLimit });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "Send failed", rateLimit },
      { status: 502 }
    );
  }
}
