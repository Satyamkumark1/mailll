import { sql } from "./db.ts";

export interface PushSubscriptionRecord {
  endpoint: string;
  p256dh: string;
  auth: string;
}

export interface PushSubscriptionInput {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

// Re-subscribing from the same browser (e.g. after clearing permission and
// re-granting it) reuses the same endpoint — upsert rather than error.
export async function saveSubscription(userId: string, sub: PushSubscriptionInput): Promise<void> {
  await sql`
    INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth)
    VALUES (${userId}, ${sub.endpoint}, ${sub.keys.p256dh}, ${sub.keys.auth})
    ON CONFLICT (endpoint) DO UPDATE SET user_id = ${userId}, p256dh = ${sub.keys.p256dh}, auth = ${sub.keys.auth}
  `;
}

export async function deleteSubscriptionByEndpoint(endpoint: string): Promise<void> {
  await sql`DELETE FROM push_subscriptions WHERE endpoint = ${endpoint}`;
}

export async function listSubscriptions(): Promise<PushSubscriptionRecord[]> {
  const rows = await sql`SELECT endpoint, p256dh, auth FROM push_subscriptions`;
  return rows.map((r) => ({
    endpoint: r.endpoint as string,
    p256dh: r.p256dh as string,
    auth: r.auth as string,
  }));
}
