import type { DraftResult, OutreachConfig } from "./store";
import type { CampaignEmailStatus, CampaignStatus } from "./campaigns";

export interface CampaignEmailView {
  email: string;
  status: CampaignEmailStatus;
  error: string | null;
  sentAt: string | null;
}

export interface CampaignView {
  id: string;
  status: CampaignStatus;
  createdAt: string;
  windowStart: string;
  windowEnd: string;
  totalCount: number;
  sentCount: number;
  failedCount: number;
  emails: CampaignEmailView[];
}

export async function createBackgroundCampaign(
  drafts: DraftResult[],
  config: OutreachConfig,
  durationHours: number
): Promise<{ id: string }> {
  const res = await fetch("/api/campaigns", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ drafts, config, durationHours }),
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || `Failed to schedule campaign (HTTP ${res.status})`);
  }
  return data;
}

export async function getCampaignStatus(id: string): Promise<CampaignView> {
  const res = await fetch(`/api/campaigns/${id}`);
  if (!res.ok) {
    throw new Error(`Failed to fetch campaign status (HTTP ${res.status})`);
  }
  return res.json();
}

export async function cancelBackgroundCampaign(id: string): Promise<void> {
  const res = await fetch(`/api/campaigns/${id}/cancel`, { method: "POST" });
  if (!res.ok) {
    throw new Error(`Failed to cancel campaign (HTTP ${res.status})`);
  }
}
