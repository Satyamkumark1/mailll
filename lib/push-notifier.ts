import webpush from "web-push";
import { listSubscriptions, deleteSubscriptionByEndpoint } from "./push-subscriptions.ts";

const vapidPublicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
const vapidPrivateKey = process.env.VAPID_PRIVATE_KEY;
const vapidSubject = process.env.VAPID_SUBJECT;

if (vapidPublicKey && vapidPrivateKey && vapidSubject) {
  webpush.setVapidDetails(vapidSubject, vapidPublicKey, vapidPrivateKey);
}

function isExpiredSubscriptionError(err: unknown): boolean {
  return typeof err === "object" && err !== null && "statusCode" in err
    && ((err as { statusCode?: number }).statusCode === 404 || (err as { statusCode?: number }).statusCode === 410);
}

// Broadcasts to every stored subscription — this is a single-operator tool,
// not multi-tenant, so there's no per-user targeting. Never throws: a push
// failure must not fail the send/tick path that triggered it.
async function broadcast(payload: { title: string; body: string }): Promise<void> {
  if (!vapidPublicKey || !vapidPrivateKey || !vapidSubject) return;
  try {
    const subs = await listSubscriptions();
    await Promise.allSettled(
      subs.map(async (sub) => {
        try {
          await webpush.sendNotification(
            { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
            JSON.stringify(payload)
          );
        } catch (err) {
          if (isExpiredSubscriptionError(err)) {
            await deleteSubscriptionByEndpoint(sub.endpoint);
          } else {
            console.error("Push send failed:", err);
          }
        }
      })
    );
  } catch (err) {
    console.error("Push broadcast failed:", err);
  }
}

export function notifySendStarted(): Promise<void> {
  return broadcast({ title: "Sending started", body: "Your campaign has started sending emails." });
}

export function notifyAccountPaused(label: string): Promise<void> {
  return broadcast({ title: "Account paused", body: `${label} was paused after repeated send failures.` });
}
