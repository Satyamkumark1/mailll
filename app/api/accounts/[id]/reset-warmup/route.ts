import { getAccount, resetWarmup } from "@/lib/sender-accounts";

export const runtime = "nodejs";

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const accountId = Number((await params).id);
  if (!(await getAccount(accountId))) {
    return Response.json({ error: "Account not found" }, { status: 404 });
  }
  await resetWarmup(accountId);
  return Response.json({ success: true });
}
