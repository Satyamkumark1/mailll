import { resetWarmup } from "@/lib/sender-settings";

export const runtime = "nodejs";

export async function POST() {
  await resetWarmup();
  return Response.json({ success: true });
}
