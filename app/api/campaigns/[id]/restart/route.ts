import { computeMinDurationHours, formatDurationHours } from "@/lib/campaign-schedule";
import { getCampaign, restartCampaign } from "@/lib/campaigns";
import { getRateLimitConfig } from "@/lib/send-rate-limiter";
import { getCurrentUser } from "@/lib/current-user";
import { logActivity } from "@/lib/activity-log";

export const runtime = "nodejs";

interface RestartCampaignBody {
  durationHours: number;
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const campaign = await getCampaign(id);
  if (!campaign) {
    return Response.json({ error: "Campaign not found" }, { status: 404 });
  }
  if (campaign.status !== "canceled") {
    return Response.json({ error: "Only a canceled campaign can be restarted" }, { status: 400 });
  }

  const remaining = campaign.emails.filter((e) => e.status === "canceled").length;
  if (remaining === 0) {
    return Response.json({ error: "No canceled emails left to restart" }, { status: 400 });
  }

  const { durationHours } = (await request.json()) as RestartCampaignBody;
  if (typeof durationHours !== "number" || !Number.isFinite(durationHours) || durationHours <= 0) {
    return Response.json({ error: "durationHours must be a positive number" }, { status: 400 });
  }

  const { hourlyCap } = await getRateLimitConfig();
  const minHours = computeMinDurationHours(remaining, hourlyCap);
  if (durationHours < minHours) {
    return Response.json(
      {
        error: `${remaining} email(s) need at least ${formatDurationHours(minHours)} to stay paced safely.`,
        minHours,
      },
      { status: 400 }
    );
  }

  await restartCampaign(id, durationHours);
  const user = await getCurrentUser();
  await logActivity({
    actorType: "user",
    actorUserId: user?.userId ?? null,
    actorLabel: user?.email ?? null,
    action: "campaign.restarted",
    entityType: "campaign",
    entityId: id,
    summary: `Restarted campaign (${remaining} email(s) rescheduled)`,
  });
  return Response.json({ success: true });
}
