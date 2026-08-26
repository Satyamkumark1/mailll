import {
  getEffectiveRateLimitConfig,
  getSenderSettings,
  saveSenderSettings,
  type SaveSenderSettingsInput,
} from "@/lib/sender-settings";

export const runtime = "nodejs";

export async function GET() {
  const settings = await getSenderSettings();
  const effective = await getEffectiveRateLimitConfig();

  return Response.json({
    configured: settings !== null,
    smtpHost: settings?.smtpHost ?? "",
    smtpPort: settings?.smtpPort ?? 465,
    smtpUser: settings?.smtpUser ?? "",
    hasPassword: settings !== null,
    hourlyCap: settings?.hourlyCap ?? 35,
    dailyCap: settings?.dailyCap ?? 150,
    warmupEnabled: settings?.warmupEnabled ?? true,
    effective,
  });
}

export async function POST(request: Request) {
  const body = (await request.json()) as SaveSenderSettingsInput;

  try {
    const result = await saveSenderSettings(body);
    return Response.json({ success: true, warning: result.warning });
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : "Failed to save settings" }, { status: 400 });
  }
}
