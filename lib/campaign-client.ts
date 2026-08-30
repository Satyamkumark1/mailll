import type { DraftResult, OutreachConfig } from "./store";
import type { BounceType, CampaignEmailStatus, CampaignStatus, DeliveryStatus } from "./campaigns";

// Shared between the Send and History pages: Send rehydrates/tracks the
// single "active" campaign id under this key, History writes it before
// navigating a user to Send to view a campaign from the list.
export const CAMPAIGN_ID_STORAGE_KEY = "elevique_active_campaign_id";
export const CAMPAIGN_POLL_MS = 20_000;

export interface CampaignEmailView {
  id: string;
  email: string;
  status: CampaignEmailStatus;
  error: string | null;
  sentAt: string | null;
  scheduledAt: string;
  deliveryStatus: DeliveryStatus;
  bounceReason: string | null;
  bounceType: BounceType;
  openedAt: string | null;
  openCount: number;
  clickedAt: string | null;
  clickCount: number;
  unsubscribedAt: string | null;
  accountLabel: string | null;
}

export interface CampaignListView {
  id: string;
  status: CampaignStatus;
  createdAt: string;
  windowStart: string;
  windowEnd: string;
  totalCount: number;
  sentCount: number;
  failedCount: number;
  skippedCount: number;
}

export interface CampaignView extends CampaignListView {
  consecutiveFailures: number;
  emails: CampaignEmailView[];
}

export async function createBackgroundCampaign(
  drafts: DraftResult[],
  config: OutreachConfig,
  durationHours: number,
  startAt?: string
): Promise<{ id: string; excludedCount: number }> {
  const res = await fetch("/api/campaigns", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ drafts, config, durationHours, startAt }),
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || `Failed to schedule campaign (HTTP ${res.status})`);
  }
  return data;
}

export async function listCampaigns(): Promise<CampaignListView[]> {
  const res = await fetch("/api/campaigns");
  if (!res.ok) {
    throw new Error(`Failed to load campaign history (HTTP ${res.status})`);
  }
  const data = await res.json();
  return data.campaigns;
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

// For a *canceled* campaign — reschedules its un-sent emails over a fresh
// window starting now, rather than just flipping the status bit back.
export async function restartBackgroundCampaign(id: string, durationHours: number): Promise<void> {
  const res = await fetch(`/api/campaigns/${id}/restart`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ durationHours }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || `Failed to restart campaign (HTTP ${res.status})`);
  }
}

// Pulls specific still-pending rows out of a campaign without canceling the
// whole thing — the emailIds are campaign_emails row ids (from CampaignView's
// emails[].id), not email addresses.
export async function skipCampaignEmails(id: string, emailIds: string[]): Promise<{ skipped: number }> {
  const res = await fetch(`/api/campaigns/${id}/skip`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ emailIds }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || `Failed to skip email(s) (HTTP ${res.status})`);
  }
  return res.json();
}
