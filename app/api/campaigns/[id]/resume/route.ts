import { getCampaign, resumeCampaign } from "@/lib/campaigns";

export const runtime = "nodejs";

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const campaign = await getCampaign(id);
  if (!campaign) {
    return Response.json({ error: "Campaign not found" }, { status: 404 });
  }
  await resumeCampaign(id);
  return Response.json({ success: true });
}
