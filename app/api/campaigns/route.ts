import { computeMinDurationHours, formatDurationHours } from "@/lib/campaign-schedule";
import { createCampaign, listCampaigns } from "@/lib/campaigns";
import { getRateLimitConfig } from "@/lib/send-rate-limiter";
import { listAccounts } from "@/lib/sender-accounts";
import type { DraftResult, OutreachConfig } from "@/lib/store";

export const runtime = "nodejs";

interface CreateCampaignBody {
  drafts: DraftResult[];
  config: OutreachConfig;
  durationHours: number;
  startAt?: string;
}

export async function GET() {
  const campaigns = await listCampaigns();
  return Response.json({ campaigns });
}

export async function POST(request: Request) {
  const accounts = await listAccounts();
  if (!accounts.some((a) => a.status === "active")) {
    return Response.json({ error: "No active sender account configured yet — set one up in Settings." }, { status: 500 });
  }

  const { drafts, config, durationHours, startAt } = (await request.json()) as CreateCampaignBody;

  if (!Array.isArray(drafts) || drafts.length === 0) {
    return Response.json({ error: "No drafts to schedule" }, { status: 400 });
  }
  if (!config) {
    return Response.json({ error: "Missing outreach config" }, { status: 400 });
  }
  if (typeof durationHours !== "number" || !Number.isFinite(durationHours) || durationHours <= 0) {
    return Response.json({ error: "durationHours must be a positive number" }, { status: 400 });
  }
  if (startAt !== undefined && Number.isNaN(new Date(startAt).getTime())) {
    return Response.json({ error: "startAt must be a valid date/time" }, { status: 400 });
  }

  const { hourlyCap } = await getRateLimitConfig();
  const minHours = computeMinDurationHours(drafts.length, hourlyCap);
  if (durationHours < minHours) {
    return Response.json(
      {
        error: `${drafts.length} email(s) need at least ${formatDurationHours(minHours)} to stay paced safely.`,
        minHours,
      },
      { status: 400 }
    );
  }

  try {
    const { id, excludedCount } = await createCampaign({ drafts, config, durationHours, startAt });
    return Response.json({ id, excludedCount });
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : "Failed to schedule campaign" }, { status: 400 });
  }
}
