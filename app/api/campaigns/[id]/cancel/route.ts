import { cancelCampaign, getCampaign } from "@/lib/campaigns";
import { getCurrentUser } from "@/lib/current-user";
import { logActivity } from "@/lib/activity-log";

export const runtime = "nodejs";

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const campaign = await getCampaign(id);
  if (!campaign) {
    return Response.json({ error: "Campaign not found" }, { status: 404 });
  }
  const canceledCount = await cancelCampaign(id);
  const user = await getCurrentUser();
  await logActivity({
    actorType: "user",
    actorUserId: user?.userId ?? null,
    actorLabel: user?.email ?? null,
    action: "campaign.canceled",
    entityType: "campaign",
    entityId: id,
    summary: `Canceled campaign (${canceledCount} pending email(s))`,
  });
  return Response.json({ success: true });
}
