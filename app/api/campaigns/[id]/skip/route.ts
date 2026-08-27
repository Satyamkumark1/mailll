import { getCampaign, skipCampaignEmails } from "@/lib/campaigns";

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
  return Response.json({ skipped });
}
