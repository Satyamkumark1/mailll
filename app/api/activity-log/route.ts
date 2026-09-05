import { listActivityLog } from "@/lib/activity-log";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const entries = await listActivityLog({
    before: params.get("before"),
    category: params.get("category"),
    limit: params.get("limit") ? Number(params.get("limit")) : undefined,
  });
  return Response.json({ entries });
}
