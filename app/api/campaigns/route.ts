import { createCampaign } from "@/lib/campaigns";
import { getRateLimitConfig } from "@/lib/send-rate-limiter";
import type { DraftResult, OutreachConfig } from "@/lib/store";

export const runtime = "nodejs";

interface CreateCampaignBody {
  drafts: DraftResult[];
  config: OutreachConfig;
  durationHours: number;
}

export async function POST(request: Request) {
  const user = process.env.EMAIL_USER?.trim();
  const pass = process.env.EMAIL_PASSWORD?.trim();
  if (!user || !pass) {
    return Response.json(
      { error: "EMAIL_USER / EMAIL_PASSWORD not set (server restart required after adding)" },
      { status: 500 }
    );
  }

  const { drafts, config, durationHours } = (await request.json()) as CreateCampaignBody;

  if (!Array.isArray(drafts) || drafts.length === 0) {
    return Response.json({ error: "No drafts to schedule" }, { status: 400 });
  }
  if (!config) {
    return Response.json({ error: "Missing outreach config" }, { status: 400 });
  }
  if (typeof durationHours !== "number" || !Number.isFinite(durationHours) || durationHours <= 0) {
    return Response.json({ error: "durationHours must be a positive number" }, { status: 400 });
  }

  const { hourlyCap } = getRateLimitConfig();
  const minHours = Math.ceil(drafts.length / hourlyCap);
  if (durationHours < minHours) {
    return Response.json(
      {
        error: `${drafts.length} emails at a ${hourlyCap}/hr cap need at least ${minHours} hour(s).`,
        minHours,
      },
      { status: 400 }
    );
  }

  const id = await createCampaign({ drafts, config, durationHours });
  return Response.json({ id });
}
