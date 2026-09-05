import type { ActorType } from "./activity-log";

export const ACTIVITY_LOG_POLL_MS = 20_000;

export interface ActivityLogEntryView {
  id: string;
  createdAt: string;
  actorType: ActorType;
  actorUserId: string | null;
  actorLabel: string | null;
  action: string;
  entityType: string | null;
  entityId: string | null;
  summary: string;
  metadata: Record<string, unknown> | null;
}

export async function listActivityLogView(options: { before?: string | null; category?: string | null } = {}): Promise<ActivityLogEntryView[]> {
  const params = new URLSearchParams();
  if (options.before) params.set("before", options.before);
  if (options.category) params.set("category", options.category);
  const res = await fetch(`/api/activity-log${params.toString() ? `?${params}` : ""}`);
  if (!res.ok) {
    throw new Error(`Failed to load activity log (HTTP ${res.status})`);
  }
  const data = await res.json();
  return data.entries;
}
