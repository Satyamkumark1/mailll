import { getCampaign, skipCampaignEmails } from "@/lib/campaigns";
import { getCurrentUser } from "@/lib/current-user";
import { logActivity } from "@/lib/activity-log";

export const runtime = "nodejs";

interface SkipCampaignEmailsBody {
  emailIds: string[];
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const campaign = await getCampaign(id);
  if (!campaign) {
    return Response.json({ error: "Campaign not found" }, { status: 404 });
  }

  const { emailIds } = (await request.json()) as SkipCampaignEmailsBody;
  if (!Array.isArray(emailIds) || emailIds.length === 0) {
    return Response.json({ error: "emailIds must be a non-empty array" }, { status: 400 });
  }

  const skipped = await skipCampaignEmails(id, emailIds);
  const user = await getCurrentUser();
  await logActivity({
    actorType: "user",
    actorUserId: user?.userId ?? null,
    actorLabel: user?.email ?? null,
    action: "campaign.emails_skipped",
    entityType: "campaign",
    entityId: id,
    summary: `Skipped ${skipped} pending email(s) in campaign`,
  });
  return Response.json({ skipped });
}
