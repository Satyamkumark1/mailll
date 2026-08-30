import { getAccount, updateAccount, type SaveAccountInput } from "@/lib/sender-accounts";

export const runtime = "nodejs";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const accountId = Number((await params).id);
  if (!Number.isInteger(accountId)) {
    return Response.json({ error: "Invalid account id" }, { status: 400 });
  }
  if (!(await getAccount(accountId))) {
    return Response.json({ error: "Account not found" }, { status: 404 });
  }

  const body = (await request.json()) as SaveAccountInput;
  try {
    const result = await updateAccount(accountId, body);
    return Response.json({ success: true, warning: result.warning });
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : "Failed to save account" }, { status: 400 });
  }
}
