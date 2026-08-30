"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/icon";
import { useValidatorChrome } from "../layout";
import {
  cancelBackgroundCampaign,
  listCampaigns,
  restartBackgroundCampaign,
  CAMPAIGN_ID_STORAGE_KEY,
  CAMPAIGN_POLL_MS,
  type CampaignListView,
} from "@/lib/campaign-client";
import { computeMinDurationHours, formatDurationHours } from "@/lib/campaign-schedule";
import { getSendRateStatus } from "@/lib/email-sender";
import { describeRateLimitBlock, formatRetryAfter } from "@/lib/send-rate-limiter";
import { useValidatorStore } from "@/lib/store";
import { cn } from "@/lib/utils";

const CAMPAIGN_STATUS_STYLES: Record<CampaignListView["status"], string> = {
  running: "bg-primary/10 text-primary border border-primary/20",
  completed: "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20",
  canceled: "bg-on-surface-variant/10 text-on-surface-variant border border-outline",
};

export default function HistoryPage() {
  const router = useRouter();
  const { confirmAction } = useValidatorChrome();
  const { setActiveCampaignId, rateLimitStatus, setRateLimitStatus } = useValidatorStore();

  const [campaignHistory, setCampaignHistory] = useState<CampaignListView[] | null>(null);
  const [historyError, setHistoryError] = useState<string | null>(null);

  // Campaign history is read fresh from the server every time — unlike the
  // single "active" campaign on the Send page, it doesn't depend on
  // localStorage, so it's the one place you can always find a campaign's
  // outcome even if you never reopened the tab that scheduled it.
  useEffect(() => {
    const load = () => {
      listCampaigns()
        .then(setCampaignHistory)
        .catch((err) => setHistoryError(err instanceof Error ? err.message : "Failed to load campaign history"));
      getSendRateStatus().then(setRateLimitStatus).catch(() => {});
    };
    load();
    const interval = setInterval(load, CAMPAIGN_POLL_MS);
    return () => clearInterval(interval);
  }, [setRateLimitStatus]);

  const trackCampaign = useCallback(
    (id: string) => {
      window.localStorage.setItem(CAMPAIGN_ID_STORAGE_KEY, id);
      setActiveCampaignId(id);
      router.push("/validator/send");
    },
    [setActiveCampaignId, router]
  );

  const cancelCampaignFromHistory = useCallback(
    async (id: string) => {
      const confirmed = await confirmAction("Cancel this background campaign? Emails already sent cannot be recalled.", {
        title: "Cancel this campaign?",
        confirmLabel: "Cancel campaign",
        tone: "danger",
      });
      if (!confirmed) return;
      try {
        await cancelBackgroundCampaign(id);
        setCampaignHistory(await listCampaigns());
      } catch (err) {
        setHistoryError(err instanceof Error ? err.message : "Failed to cancel campaign");
      }
    },
    [confirmAction]
  );

  // For a canceled campaign, totalCount - sentCount - failedCount - skippedCount
  // is exactly the count of rows still sitting at status 'canceled'
  // (cancelCampaign() flips every pending row to 'canceled', but leaves any
  // already-skipped rows alone) — so no extra field is needed on
  // CampaignListView to know whether there's anything left to restart.
  const restartCampaignFromHistory = useCallback(
    async (c: CampaignListView) => {
      const remaining = c.totalCount - c.sentCount - c.failedCount - c.skippedCount;
      if (remaining <= 0) return;
      const durationHours = computeMinDurationHours(remaining, rateLimitStatus?.hourly.cap ?? 35);
      const confirmed = await confirmAction(
        `This will resume the ${remaining} canceled email(s), rescheduling them to send starting now, spread over ${formatDurationHours(durationHours)}. Continue?`,
        { title: "Resume campaign?", confirmLabel: "Resume campaign", tone: "primary" }
      );
      if (!confirmed) return;
      try {
        await restartBackgroundCampaign(c.id, durationHours);
        setCampaignHistory(await listCampaigns());
      } catch (err) {
        setHistoryError(err instanceof Error ? err.message : "Failed to resume campaign");
      }
    },
    [confirmAction, rateLimitStatus]
  );

  return (
    <div className="space-y-lg">
      <div className="space-y-xs">
        <span className="text-[10px] font-bold text-primary uppercase tracking-wider">History</span>
        <h1 className="text-headline-lg font-bold text-on-surface tracking-tight">Campaign History</h1>
        <p className="text-body-md text-on-surface-variant">
          Every background campaign ever scheduled from this app, read fresh from the server — this works even if you never reopen the tab that started one.
        </p>
      </div>

      {historyError && (
        <div className="flex items-start gap-sm rounded-xl border border-red-500/20 bg-red-500/10 px-md py-sm text-body-sm text-red-400">
          <Icon name="error" className="text-[18px]" />
          <span>{historyError}</span>
        </div>
      )}

      {campaignHistory === null ? (
        <p className="text-body-sm text-on-surface-variant">Loading...</p>
      ) : campaignHistory.length === 0 ? (
        <div className="flex flex-col items-center gap-md rounded-2xl border border-outline bg-surface p-xl text-center shadow-lg">
          <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/10 text-primary border border-primary/20">
            <Icon name="history" className="text-[32px] font-bold" />
          </div>
          <h3 className="text-headline-md font-bold text-on-surface">No campaigns yet</h3>
          <p className="text-body-sm text-on-surface-variant max-w-[24rem]">
            Schedule a background campaign from the Send stage and it&apos;ll show up here.
          </p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-outline bg-surface shadow-sm">
          <div className="overflow-auto">
          <table className="w-full min-w-[640px] border-collapse text-left text-body-sm">
            <thead className="bg-surface-container border-b border-outline select-none">
              <tr>
                <th className="px-md py-md text-[10px] font-bold uppercase tracking-wider text-on-surface-variant">Created</th>
                <th className="px-md py-md text-[10px] font-bold uppercase tracking-wider text-on-surface-variant">Status</th>
                <th className="px-md py-md text-[10px] font-bold uppercase tracking-wider text-on-surface-variant">Progress</th>
                <th className="px-md py-md text-[10px] font-bold uppercase tracking-wider text-on-surface-variant">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-outline/40">
              {campaignHistory.map((c) => (
                <tr key={c.id} className="hover:bg-surface-container/20">
                  <td className="px-md py-md text-xs text-on-surface-variant font-mono">
                    {new Date(c.createdAt).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })}
                  </td>
                  <td className="px-md py-md select-none">
                    <span className={cn("rounded px-sm py-[2px] text-[10px] font-bold uppercase inline-block text-center", CAMPAIGN_STATUS_STYLES[c.status])}>
                      {c.status}
                    </span>
                  </td>
                  <td className="px-md py-md text-xs text-on-surface font-mono">
                    {c.sentCount + c.failedCount + c.skippedCount} / {c.totalCount} processed
                    {c.failedCount > 0 && <span className="ml-sm text-red-400 font-bold">{c.failedCount} failed</span>}
                    {c.status === "running" &&
                      c.totalCount - c.sentCount - c.failedCount - c.skippedCount > 0 &&
                      rateLimitStatus &&
                      !rateLimitStatus.allowed && (
                        <span
                          className="ml-sm text-amber-400 font-semibold"
                          title={`Paused — you've hit ${describeRateLimitBlock(rateLimitStatus)}. Resumes in about ${formatRetryAfter(rateLimitStatus.retryAfterSeconds)}.`}
                        >
                          (paused — cap reached, resumes in ~{formatRetryAfter(rateLimitStatus.retryAfterSeconds)})
                        </span>
                      )}
                  </td>
                  <td className="px-md py-md">
                    <div className="flex gap-sm">
                      <button
                        onClick={() => trackCampaign(c.id)}
                        className="rounded-lg border border-outline bg-surface-container-low px-sm py-xs text-xs font-bold text-on-surface transition-colors hover:bg-surface-container cursor-pointer"
                      >
                        View
                      </button>
                      {c.status === "running" && (
                        <button
                          onClick={() => cancelCampaignFromHistory(c.id)}
                          className="rounded-lg border border-red-500/25 bg-red-500/10 px-sm py-xs text-xs font-bold text-red-300 transition-colors hover:bg-red-500/20 cursor-pointer"
                        >
                          Cancel
                        </button>
                      )}
                      {c.status === "canceled" && c.totalCount - c.sentCount - c.failedCount - c.skippedCount > 0 && (
                        <button
                          onClick={() => restartCampaignFromHistory(c)}
                          className="rounded-lg border border-primary/40 bg-primary/10 px-sm py-xs text-xs font-bold text-primary transition-colors hover:bg-primary/20 cursor-pointer"
                        >
                          Resume
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        </div>
      )}
    </div>
  );
}
