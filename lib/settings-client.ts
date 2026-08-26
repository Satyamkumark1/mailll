import type { EffectiveRateLimitConfig } from "./sender-settings";

export interface SenderSettingsView {
  configured: boolean;
  smtpHost: string;
  smtpPort: number;
  smtpUser: string;
  hasPassword: boolean;
  hourlyCap: number;
  dailyCap: number;
  warmupEnabled: boolean;
  effective: EffectiveRateLimitConfig;
}

export interface SaveSenderSettingsPayload {
  smtpHost: string;
  smtpPort: number;
  smtpUser: string;
  smtpPassword?: string;
  hourlyCap: number;
  dailyCap: number;
  warmupEnabled: boolean;
}

export async function getSenderSettingsView(): Promise<SenderSettingsView> {
  const res = await fetch("/api/settings");
  if (!res.ok) {
    throw new Error(`Failed to load settings (HTTP ${res.status})`);
  }
  return res.json();
}

export async function saveSenderSettingsView(payload: SaveSenderSettingsPayload): Promise<{ warning: string | null }> {
  const res = await fetch("/api/settings", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || `Failed to save settings (HTTP ${res.status})`);
  }
  return data;
}

export async function resetWarmupClient(): Promise<void> {
  const res = await fetch("/api/settings/reset-warmup", { method: "POST" });
  if (!res.ok) {
    throw new Error(`Failed to reset warm-up (HTTP ${res.status})`);
  }
}
