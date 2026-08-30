import { createAccount, getEffectiveRateLimitConfig, listAccounts, type SaveAccountInput } from "@/lib/sender-accounts";

export const runtime = "nodejs";

export async function GET() {
  const accounts = await listAccounts();
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
    })),
  });
}

export async function POST(request: Request) {
  const body = (await request.json()) as SaveAccountInput;

  try {
    const result = await createAccount(body);
    return Response.json({ success: true, id: result.id, warning: result.warning });
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : "Failed to create account" }, { status: 400 });
  }
}
