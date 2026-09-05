import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { AUTH_COOKIE_NAME, verifySessionToken } from "@/lib/auth";
import { deleteSubscriptionByEndpoint } from "@/lib/push-subscriptions";
import { logActivity } from "@/lib/activity-log";

export async function POST(request: Request) {
  try {
    const cookieStore = await cookies();
    const token = cookieStore.get(AUTH_COOKIE_NAME)?.value;
    const payload = await verifySessionToken(token);
    if (!payload) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    if (!body?.endpoint) {
      return NextResponse.json({ error: "Missing endpoint" }, { status: 400 });
    }

    await deleteSubscriptionByEndpoint(body.endpoint);
    await logActivity({
      actorType: "user",
      actorUserId: payload.userId,
      actorLabel: payload.email,
      action: "push.unsubscribed",
      summary: `${payload.email} disabled push notifications`,
    });
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Push unsubscribe error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to remove subscription" },
      { status: 500 }
    );
  }
}
