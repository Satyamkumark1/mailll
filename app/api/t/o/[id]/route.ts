import { sql } from "@/lib/db";

export const runtime = "nodejs";

// 1x1 transparent GIF — served unconditionally, even if the DB update below
// fails, since a tracking pixel must never fail to render in the recipient's
// mail client.
const PIXEL = Buffer.from("R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==", "base64");

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    await sql`
      UPDATE campaign_emails SET opened_at = COALESCE(opened_at, now()), open_count = open_count + 1
      WHERE id = ${id}
    `;
  } catch (err) {
    console.error("open-tracking update failed for", id, ":", err instanceof Error ? err.message : err);
  }
  return new Response(PIXEL, { headers: { "Content-Type": "image/gif", "Cache-Control": "no-store" } });
}
