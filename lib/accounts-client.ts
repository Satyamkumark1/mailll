import type { AccountStatus, EffectiveRateLimitConfig } from "./sender-accounts";

export interface AccountView {
  id: number;
  label: string;
  status: AccountStatus;
  smtpHost: string;
  smtpPort: number;
  smtpUser: string;
  hourlyCap: number;
  dailyCap: number;
  warmupEnabled: boolean;
  consecutiveFailures: number;
  effective: EffectiveRateLimitConfig;
  lockedByCampaignId: string | null;
}

export interface SaveAccountPayload {
  label?: string;
  smtpHost: string;
  smtpPort: number;
  smtpUser: string;
  smtpPassword?: string; // blank/undefined on update = keep existing; required on create
  hourlyCap: number;
  dailyCap: number;
  warmupEnabled: boolean;
}

export interface SaveAccountResult {
  warning: string | null;
}

export async function listAccountsView(): Promise<AccountView[]> {
  const res = await fetch("/api/accounts");
  if (!res.ok) {
    throw new Error(`Failed to load accounts (HTTP ${res.status})`);
  }
  const data = await res.json();
  return data.accounts;
}

export async function createAccountView(payload: SaveAccountPayload): Promise<{ id: number } & SaveAccountResult> {
  const res = await fetch("/api/accounts", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || `Failed to create account (HTTP ${res.status})`);
  }
  return data;
}

export async function updateAccountView(id: number, payload: SaveAccountPayload): Promise<SaveAccountResult> {
  const res = await fetch(`/api/accounts/${id}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || `Failed to save account (HTTP ${res.status})`);
  }
  return data;
}

export async function resetWarmupView(id: number): Promise<void> {
  const res = await fetch(`/api/accounts/${id}/reset-warmup`, { method: "POST" });
  if (!res.ok) {
    throw new Error(`Failed to reset warm-up (HTTP ${res.status})`);
  }
}

export async function pauseAccountView(id: number): Promise<void> {
  const res = await fetch(`/api/accounts/${id}/pause`, { method: "POST" });
  if (!res.ok) {
    throw new Error(`Failed to pause account (HTTP ${res.status})`);
  }
}

export async function resumeAccountView(id: number): Promise<void> {
  const res = await fetch(`/api/accounts/${id}/resume`, { method: "POST" });
  if (!res.ok) {
    throw new Error(`Failed to resume account (HTTP ${res.status})`);
  }
}
