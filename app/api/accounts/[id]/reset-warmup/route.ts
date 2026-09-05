import { getAccount, resetWarmup } from "@/lib/sender-accounts";
import { getCurrentUser } from "@/lib/current-user";
import { logActivity } from "@/lib/activity-log";

export const runtime = "nodejs";

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const accountId = Number((await params).id);
  const existing = await getAccount(accountId);
  if (!existing) {
    return Response.json({ error: "Account not found" }, { status: 404 });
  }
  await resetWarmup(accountId);
  const user = await getCurrentUser();
  await logActivity({
    actorType: "user",
    actorUserId: user?.userId ?? null,
    actorLabel: user?.email ?? null,
    action: "account.warmup_reset",
    entityType: "sender_account",
    entityId: String(accountId),
    summary: `Reset warm-up for account "${existing.label}"`,
  });
  return Response.json({ success: true });
}
