import { sql } from "./db.ts";

export type ActorType = "user" | "system" | "recipient";

export interface LogActivityInput {
  actorType: ActorType;
  actorUserId?: string | null; // users.id (UUID) — only ever set for actorType 'user'
  actorLabel?: string | null; // email, or a fixed source tag like 'cron-tick'
  action: string; // dot-namespaced, e.g. 'campaign.created'
  entityType?: string | null;
  entityId?: string | null;
  summary: string;
  metadata?: Record<string, unknown> | null;
}

// Never throws — a logging failure must never break the action that
// triggered it (same contract as lib/push-notifier.ts's broadcast()). Still
// awaited by every caller rather than fire-and-forget: a Vercel function
// isn't guaranteed to keep running background work after it returns a response.
export async function logActivity(input: LogActivityInput): Promise<void> {
  try {
    await sql`
      INSERT INTO activity_log (actor_type, actor_user_id, actor_label, action, entity_type, entity_id, summary, metadata)
      VALUES (
        ${input.actorType}, ${input.actorUserId ?? null}, ${input.actorLabel ?? null}, ${input.action},
        ${input.entityType ?? null}, ${input.entityId ?? null}, ${input.summary},
        ${input.metadata ? JSON.stringify(input.metadata) : null}::jsonb
      )
    `;
  } catch (err) {
    console.error("logActivity failed:", input.action, err);
  }
}

export interface ActivityLogEntry {
  id: string; // stringified BIGSERIAL — never risk JS number precision
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

export interface ListActivityLogOptions {
  before?: string | null; // cursor: id of the last row already seen
  limit?: number;
  category?: string | null; // action prefix before the first '.', e.g. 'campaign'
}

export async function listActivityLog(options: ListActivityLogOptions = {}): Promise<ActivityLogEntry[]> {
  const limit = Math.min(Math.max(options.limit ?? 50, 1), 200);
  const cursor = options.before ?? null;
  const categoryPrefix = options.category ? `${options.category}.%` : null;

  const rows = await sql`
    SELECT id, created_at, actor_type, actor_user_id, actor_label, action, entity_type, entity_id, summary, metadata
    FROM activity_log
    WHERE (${cursor}::bigint IS NULL OR id < ${cursor}::bigint)
      AND (${categoryPrefix}::text IS NULL OR action LIKE ${categoryPrefix})
    ORDER BY id DESC
    LIMIT ${limit}
  `;
  return rows.map((r) => ({
    id: String(r.id),
    createdAt: r.created_at as string,
    actorType: r.actor_type as ActorType,
    actorUserId: (r.actor_user_id as string | null) ?? null,
    actorLabel: (r.actor_label as string | null) ?? null,
    action: r.action as string,
    entityType: (r.entity_type as string | null) ?? null,
    entityId: (r.entity_id as string | null) ?? null,
    summary: r.summary as string,
    metadata: (r.metadata as Record<string, unknown> | null) ?? null,
  }));
}
