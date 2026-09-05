import { sql } from "@/lib/db";
import { logActivity } from "@/lib/activity-log";

export const runtime = "nodejs";

// Shared by GET (a person clicking the link in the email body or their mail
// client's own "Unsubscribe" affordance) and POST (RFC 8058 one-click
// unsubscribe — Gmail/Yahoo's bulk-sender rules expect this to work without
// rendering anything). A missing/unknown id still no-ops successfully: a
// recipient clicking unsubscribe should never see a raw error.
async function unsubscribe(id: string): Promise<void> {
  const [row] = await sql`SELECT to_email FROM campaign_emails WHERE id = ${id}`;
  if (!row) return;
  const email = (row.to_email as string).toLowerCase();
  await sql`INSERT INTO suppressed_emails (email, reason) VALUES (${email}, 'unsubscribe') ON CONFLICT (email) DO NOTHING`;
  await sql`UPDATE campaign_emails SET unsubscribed_at = now() WHERE id = ${id}`;
  await logActivity({
    actorType: "recipient",
    actorLabel: email,
    action: "email.unsubscribed",
    entityType: "campaign_email",
    entityId: id,
    summary: `${email} unsubscribed`,
  });
}

function unsubscribeFailureResponse(): Response {
  return new Response("Unable to process unsubscribe right now.", {
    status: 500,
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    await unsubscribe(id);
  } catch (err) {
    console.error("unsubscribe failed for", id, ":", err instanceof Error ? err.message : err);
    return unsubscribeFailureResponse();
  }
  return new Response(
    "<!doctype html><html><body style=\"font-family:sans-serif;text-align:center;padding:48px;\">" +
      "<p>You've been unsubscribed and won't receive further emails from us.</p></body></html>",
    { headers: { "Content-Type": "text/html; charset=utf-8" } }
  );
}

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    await unsubscribe(id);
  } catch (err) {
    console.error("one-click unsubscribe failed for", id, ":", err instanceof Error ? err.message : err);
    return unsubscribeFailureResponse();
  }
  return new Response(null, { status: 200 });
}
