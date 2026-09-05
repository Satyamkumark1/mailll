import { getAccountsLockedByRunningCampaign } from "@/lib/campaigns";
import { createAccount, getEffectiveRateLimitConfig, listAccounts, type SaveAccountInput } from "@/lib/sender-accounts";
import { getCurrentUser } from "@/lib/current-user";
import { logActivity } from "@/lib/activity-log";

export const runtime = "nodejs";

export async function GET() {
  const [accounts, lockedByAccountId] = await Promise.all([listAccounts(), getAccountsLockedByRunningCampaign()]);
  return Response.json({
    accounts: accounts.map((a) => ({
      id: a.id,
      label: a.label,
      status: a.status,
      smtpHost: a.smtpHost,
      smtpPort: a.smtpPort,
      smtpUser: a.smtpUser,
      hourlyCap: a.hourlyCap,
      dailyCap: a.dailyCap,
      warmupEnabled: a.warmupEnabled,
      consecutiveFailures: a.consecutiveFailures,
      effective: getEffectiveRateLimitConfig(a),
      lockedByCampaignId: lockedByAccountId.get(a.id) ?? null,
    })),
  });
}

export async function POST(request: Request) {
  const body = (await request.json()) as SaveAccountInput;

  try {
    const result = await createAccount(body);
    const user = await getCurrentUser();
    await logActivity({
      actorType: "user",
      actorUserId: user?.userId ?? null,
      actorLabel: user?.email ?? null,
      action: "account.created",
      entityType: "sender_account",
      entityId: String(result.id),
      summary: `Created account "${body.label?.trim() || body.smtpUser}"`,
    });
    return Response.json({ success: true, id: result.id, warning: result.warning });
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : "Failed to create account" }, { status: 400 });
  }
}
