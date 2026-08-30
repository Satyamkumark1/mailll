import { sql } from "@/lib/db";
import { verifyTrackingClickTarget } from "@/lib/tracking";

export const runtime = "nodejs";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const target = new URL(request.url).searchParams.get("u");
  const signature = new URL(request.url).searchParams.get("s");
  if (!target || !/^https?:\/\//i.test(target) || !verifyTrackingClickTarget(id, target, signature)) {
    return Response.json({ error: "Invalid or missing redirect target" }, { status: 400 });
  }

  // Must complete before the redirect response is sent — unlike the open
  // pixel, there's no later request to piggyback a fire-and-forget update on.
  try {
    const updated = await sql`
      UPDATE campaign_emails SET clicked_at = COALESCE(clicked_at, now()), click_count = click_count + 1
      WHERE id = ${id}
      RETURNING id
    `;
    if (updated.length === 0) {
      return Response.json({ error: "Tracking record not found" }, { status: 404 });
    }
  } catch (err) {
    console.error("click-tracking update failed for", id, ":", err instanceof Error ? err.message : err);
  }

  return Response.redirect(target, 302);
}
