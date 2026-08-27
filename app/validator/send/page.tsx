"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { Icon } from "@/components/icon";
import { useValidatorChrome } from "../layout";
import {
  cancelBackgroundCampaign,
  createBackgroundCampaign,
  getCampaignStatus,
  resumeBackgroundCampaign,
  CAMPAIGN_ID_STORAGE_KEY,
  CAMPAIGN_POLL_MS,
  type CampaignView,
} from "@/lib/campaign-client";
import { computeMinDurationHours, formatDurationHours } from "@/lib/campaign-schedule";
import { getSendRateStatus, sendDraftsPaced } from "@/lib/email-sender";
import { useValidatorStore, type DraftResult, type SendStatus } from "@/lib/store";
import { cn, computeDraftsStale } from "@/lib/utils";

const PACING_PRESETS = {
  cautious: { label: "Cautious", minSec: 30, maxSec: 90, note: "Lowest risk of Gmail flagging bulk sends" },
  balanced: { label: "Balanced", minSec: 10, maxSec: 25, note: "Faster, still randomized, moderate risk" },
  fast: { label: "Fast", minSec: 3, maxSec: 8, note: "Meaningfully higher risk of Gmail flagging/limiting the account" },
} as const;
type PacingKey = keyof typeof PACING_PRESETS;

const SEND_STATUS_STYLES: Record<SendStatus, string> = {
  sent: "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20",
  failed: "bg-red-500/10 text-red-400 border border-red-500/20",
};

const CAMPAIGN_EMAIL_STATUS_STYLES: Record<CampaignView["emails"][number]["status"], string> = {
  pending: "bg-on-surface-variant/10 text-on-surface-variant border border-outline",
  sending: "bg-primary/10 text-primary border border-primary/20",
  sent: "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20",
  failed: "bg-red-500/10 text-red-400 border border-red-500/20",
  canceled: "bg-on-surface-variant/10 text-on-surface-variant border border-outline",
};

export default function SendPage() {
  const { confirmAction, settingsView, openSettings } = useValidatorChrome();
  const {
    results, drafts, outreachConfig, sendResults, isSending, sendProgress,
    rateLimitStatus, sendBlockedReason, sendAutoResumeCountdown, sendPausedReason, activeCampaignId,
    setSending, setSendProgress, appendSendResults, clearSendResults, setRateLimitStatus,
    setSendBlockedReason, setSendAutoResumeCountdown, setSendPausedReason, setActiveCampaignId,
    setSendCancelRequested,
  } = useValidatorStore();

  const [pacing, setPacing] = useState<PacingKey>("cautious");
  const [sendMode, setSendMode] = useState<"now" | "schedule">("now");
  const [durationHours, setDurationHours] = useState<number | null>(null);
  const [durationTouched, setDurationTouched] = useState(false);
  const [campaign, setCampaign] = useState<CampaignView | null>(null);
  const [campaignError, setCampaignError] = useState<string | null>(null);
  const [isSchedulingCampaign, setIsSchedulingCampaign] = useState(false);
  const [startMode, setStartMode] = useState<"now" | "at">("now");
  const [startAtLocal, setStartAtLocal] = useState("");

  const validContacts = useMemo(() => results.filter((r) => r.status === "valid"), [results]);
  const draftsStale = useMemo(() => computeDraftsStale(validContacts, drafts), [validContacts, drafts]);

  useEffect(() => {
    getSendRateStatus().then(setRateLimitStatus).catch(() => {});
  }, [setRateLimitStatus]);

  // Rehydrate an in-progress background campaign on load/refresh — the send
  // loop itself runs server-side via cron, this just restores the id so the
  // progress panel can find it again after the tab was closed and reopened.
  useEffect(() => {
    const savedId = window.localStorage.getItem(CAMPAIGN_ID_STORAGE_KEY);
    if (savedId) setActiveCampaignId(savedId);
  }, [setActiveCampaignId]);

  const refreshCampaign = useCallback(async (id: string) => {
    try {
      const view = await getCampaignStatus(id);
      setCampaign(view);
      setCampaignError(null);
    } catch (err) {
      setCampaignError(err instanceof Error ? err.message : "Failed to load campaign status");
    }
  }, []);

  useEffect(() => {
    // campaign state is cleared imperatively wherever activeCampaignId is
    // cleared (see dismissCampaign) — nothing to reset here.
    if (!activeCampaignId) return;
    const load = () =>
      getCampaignStatus(activeCampaignId)
        .then(setCampaign)
        .catch((err) => setCampaignError(err instanceof Error ? err.message : "Failed to load campaign status"));
    load();
    const interval = setInterval(load, CAMPAIGN_POLL_MS);
    return () => clearInterval(interval);
  }, [activeCampaignId]);

  // Small batches shouldn't be forced into a long window just because a
  // duration was picked for a much bigger list — recommend (and default to)
  // the shortest duration that still keeps a human-ish pace and respects
  // the hourly cap, and only override it once the user actually edits the
  // field. See lib/campaign-schedule.ts.
  const minCampaignHours = computeMinDurationHours(drafts.length, rateLimitStatus?.hourly.cap ?? 35);
  const effectiveDurationHours = durationTouched && durationHours !== null ? durationHours : minCampaignHours;

  // Pure — just checks the picked value parses, no time-dependent
  // comparison (that happens at submit time in scheduleCampaign, inside an
  // event handler where calling Date.now() is fine). Memoized so it's a
  // stable reference across renders where startMode/startAtLocal haven't
  // changed, keeping scheduleCampaign's own memoization meaningful.
  const resolvedStartAt = useMemo(
    () => (startMode === "at" && startAtLocal ? new Date(startAtLocal) : null),
    [startMode, startAtLocal]
  );
  const startAtMissing = startMode === "at" && (!resolvedStartAt || Number.isNaN(resolvedStartAt.getTime()));

  const scheduleCampaign = useCallback(async () => {
    if (startMode === "at" && (!resolvedStartAt || Number.isNaN(resolvedStartAt.getTime()) || resolvedStartAt.getTime() <= Date.now())) {
      setCampaignError("Pick a start time in the future.");
      return;
    }

    const startDescription =
      startMode === "at" && resolvedStartAt ? `starting at ${resolvedStartAt.toLocaleString()}` : "starting now";
    const confirmed = await confirmAction(
      `This will schedule ${drafts.length} real email(s) to send from your Gmail account, ${startDescription}, spread over ${formatDurationHours(effectiveDurationHours)}, ` +
        `continuing on the server even if you close this tab. This cannot be undone once sent. Continue?`,
      { title: "Schedule background campaign?", confirmLabel: "Schedule campaign", tone: "primary" }
    );
    if (!confirmed) return;

    setIsSchedulingCampaign(true);
    setCampaignError(null);
    try {
      const { id } = await createBackgroundCampaign(
        drafts,
        outreachConfig,
        effectiveDurationHours,
        resolvedStartAt ? resolvedStartAt.toISOString() : undefined
      );
      window.localStorage.setItem(CAMPAIGN_ID_STORAGE_KEY, id);
      setActiveCampaignId(id);
      await refreshCampaign(id);
    } catch (err) {
      setCampaignError(err instanceof Error ? err.message : "Failed to schedule campaign");
    } finally {
      setIsSchedulingCampaign(false);
    }
  }, [drafts, outreachConfig, effectiveDurationHours, startMode, resolvedStartAt, setActiveCampaignId, refreshCampaign, confirmAction]);

  const cancelCampaign = useCallback(async () => {
    if (!activeCampaignId) return;
    const confirmed = await confirmAction("Cancel this background campaign? Emails already sent cannot be recalled.", {
      title: "Cancel this campaign?",
      confirmLabel: "Cancel campaign",
      tone: "danger",
    });
    if (!confirmed) return;
    try {
      await cancelBackgroundCampaign(activeCampaignId);
      await refreshCampaign(activeCampaignId);
    } catch (err) {
      setCampaignError(err instanceof Error ? err.message : "Failed to cancel campaign");
    }
  }, [activeCampaignId, refreshCampaign, confirmAction]);

  const resumeCampaignHandler = useCallback(async () => {
    if (!activeCampaignId) return;
    try {
      await resumeBackgroundCampaign(activeCampaignId);
      await refreshCampaign(activeCampaignId);
    } catch (err) {
      setCampaignError(err instanceof Error ? err.message : "Failed to resume campaign");
    }
  }, [activeCampaignId, refreshCampaign]);

  const dismissCampaign = useCallback(() => {
    window.localStorage.removeItem(CAMPAIGN_ID_STORAGE_KEY);
    setActiveCampaignId(null);
    setCampaign(null);
  }, [setActiveCampaignId]);

  // Shared by a fresh run (startSend) and continuing after a consecutive-
  // failure pause (resumeSend) — startDone lets a resumed run keep counting
  // progress against the original total instead of restarting the bar.
  const runSendLoop = useCallback(
    async (toSend: DraftResult[], startDone: number) => {
      const { minSec, maxSec } = PACING_PRESETS[pacing];
      setSendCancelRequested(false);
      setSending(true);
      setSendPausedReason(null);

      await sendDraftsPaced(
        toSend,
        outreachConfig,
        minSec * 1000,
        maxSec * 1000,
        (done) => setSendProgress(startDone + done, drafts.length),
        (result) => appendSendResults([result]),
        // Read fresh from the store (not a closed-over ref) — this loop is a
        // detached async chain that outlives this component: if the user
        // navigates away from /validator/send and back while a run is in
        // flight, a component-local ref would leave the original run
        // uncancellable, since the new mount's ref would be a different
        // object. The store is the one thing both mounts actually share.
        () => useValidatorStore.getState().sendCancelRequested,
        (msg, retryAfterSec) => {
          const resumeTime = new Date(Date.now() + retryAfterSec * 1000).toLocaleTimeString([], {
            hour: "2-digit",
            minute: "2-digit",
          });
          setSendBlockedReason(`${msg} Auto-resuming next batch around ${resumeTime}.`);
          getSendRateStatus().then(setRateLimitStatus).catch(() => {});
        },
        true,
        (sec) => {
          setSendAutoResumeCountdown(sec);
          if (sec === null) {
            getSendRateStatus().then(setRateLimitStatus).catch(() => {});
          }
        },
        (failCount) => {
          setSendPausedReason(
            `Sending paused after ${failCount} failed sends in a row. Check the delivery log below, then resume or dismiss.`
          );
        }
      );

      setSending(false);
      setSendAutoResumeCountdown(null);
      getSendRateStatus().then(setRateLimitStatus).catch(() => {});
    },
    [
      drafts,
      outreachConfig,
      pacing,
      setSending,
      setSendProgress,
      appendSendResults,
      setSendBlockedReason,
      setRateLimitStatus,
      setSendAutoResumeCountdown,
      setSendPausedReason,
      setSendCancelRequested,
    ]
  );

  const startSend = useCallback(async () => {
    const { minSec, maxSec } = PACING_PRESETS[pacing];
    const totalMinSec = drafts.length * minSec;
    const totalMaxSec = drafts.length * maxSec;
    const durationEstimate =
      totalMaxSec < 60
        ? `${totalMinSec}-${totalMaxSec}s`
        : `${Math.round(totalMinSec / 60)}-${Math.round(totalMaxSec / 60)} min`;
    const confirmed = await confirmAction(
      `This will send ${drafts.length} real email(s) from your Gmail account, paced ${minSec}-${maxSec}s apart ` +
        `(roughly ${durationEstimate} total). This cannot be undone once sent. Continue?`,
      { title: "Send outreach now?", confirmLabel: "Send now", tone: "primary" }
    );
    if (!confirmed) return;

    clearSendResults();
    setSendProgress(0, drafts.length);
    await runSendLoop(drafts, 0);
  }, [drafts, pacing, clearSendResults, setSendProgress, runSendLoop, confirmAction]);

  const resumeSend = useCallback(async () => {
    const remaining = drafts.slice(sendResults.length);
    if (remaining.length === 0) return;
    await runSendLoop(remaining, sendResults.length);
  }, [drafts, sendResults, runSendLoop]);

  const dismissSendPause = useCallback(() => {
    setSendPausedReason(null);
  }, [setSendPausedReason]);

  const stopSend = useCallback(() => {
    setSendCancelRequested(true);
    setSendAutoResumeCountdown(null);
    getSendRateStatus().then(setRateLimitStatus).catch(() => {});
  }, [setRateLimitStatus, setSendAutoResumeCountdown, setSendCancelRequested]);

  const renderSenderStatus = () => {
    if (!settingsView) return null;
    if (!settingsView.configured) {
      return (
        <div className="flex items-center justify-between gap-sm rounded-lg border border-amber-500/25 bg-amber-500/10 px-md py-sm text-body-sm text-amber-200">
          <span className="flex items-center gap-sm">
            <Icon name="lock" className="text-[18px]" />
            No sender account configured yet.
          </span>
          <button
            onClick={openSettings}
            className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-sm py-xs text-xs font-bold text-amber-200 hover:bg-amber-500/20 cursor-pointer"
          >
            Open Settings
          </button>
        </div>
      );
    }
    return (
      <p className="flex items-center gap-sm text-body-sm text-on-surface-variant font-semibold">
        <Icon name="lock" className="text-[20px] text-primary" />
        Sending as <code className="font-mono text-xs bg-surface-container px-1.5 py-0.5 rounded font-bold">{settingsView.smtpUser}</code>.{" "}
        <button onClick={openSettings} className="text-primary font-bold hover:underline cursor-pointer">
          Edit
        </button>
      </p>
    );
  };

  const renderWarmupNotice = () => {
    if (!settingsView?.effective.warmupActive) return null;
    return (
      <p className="text-xs font-mono text-amber-300 font-medium">
        Ramping up: {settingsView.effective.hourlyCap}/{settingsView.effective.hourlyTarget} per hour (day {settingsView.effective.warmupDay} of {settingsView.effective.warmupDays})
      </p>
    );
  };

  return (
    <div className="space-y-lg">
      <div className="space-y-xs">
        <span className="text-[10px] font-bold text-primary uppercase tracking-wider">Stage 5 — Send</span>
        <h1 className="text-headline-lg font-bold text-on-surface tracking-tight">Paced Sender Engine</h1>
        <p className="text-body-md text-on-surface-variant">
          Send AI-composed outreach paced randomly to mimic human activity and protect sender reputation.
        </p>
      </div>

      {draftsStale && (
        <div className="flex items-start gap-sm rounded-xl border border-amber-500/25 bg-amber-500/10 px-md py-sm text-body-sm text-amber-200">
          <Icon name="sync_problem" className="mt-0.5 text-[18px] text-amber-400" />
          <span>Contacts were approved after these drafts were generated. Regenerate drafts before sending to include them.</span>
        </div>
      )}

      {campaign && (
        <div className="rounded-xl border border-primary/30 bg-primary/5 p-lg shadow-sm space-y-md">
          <div className="flex items-center justify-between">
            <p className={cn("flex items-center gap-sm text-body-sm font-bold", campaign.status === "paused" ? "text-amber-400" : "text-primary")}>
              <Icon name={campaign.status === "paused" ? "pause_circle" : "cloud_sync"} className="text-[20px]" />
              {campaign.status === "running"
                ? "Background campaign running on the server"
                : campaign.status === "paused"
                ? `Paused — ${campaign.consecutiveFailures} failed in a row`
                : `Background campaign ${campaign.status}`}
            </p>
            {(campaign.status === "completed" || campaign.status === "canceled") && (
              <button onClick={dismissCampaign} className="text-xs font-bold text-on-surface-variant hover:text-on-surface cursor-pointer">
                Dismiss
              </button>
            )}
          </div>
          <p className="text-xs text-on-surface-variant">
            {campaign.status === "running"
              ? "You can close this tab — sending continues on the server until the window ends."
              : campaign.status === "paused"
              ? "The engine stopped itself after 2 consecutive failed sends — check the log below for why, fix the issue, then resume."
              : `Finished ${new Date(campaign.windowEnd).toLocaleString()}.`}
          </p>
          <p className="text-xs font-mono text-on-surface-variant/80">
            Scheduled window: {new Date(campaign.windowStart).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })}
            {" → "}
            {new Date(campaign.windowEnd).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })}
          </p>
          <div>
            <div className="mb-2 flex justify-between text-xs font-mono text-primary font-bold">
              <span>{campaign.sentCount + campaign.failedCount} / {campaign.totalCount} processed</span>
              <span>{campaign.failedCount > 0 ? `${campaign.failedCount} failed` : ""}</span>
            </div>
            <div className="h-2 w-full bg-surface-container rounded-full overflow-hidden">
              <motion.div
                className="h-full bg-primary"
                animate={{
                  width: campaign.totalCount ? `${((campaign.sentCount + campaign.failedCount) / campaign.totalCount) * 100}%` : "0%",
                }}
                transition={{ duration: 0.2 }}
              />
            </div>
          </div>
          {(campaign.status === "running" || campaign.status === "paused") && (
            <div className="flex gap-sm">
              {campaign.status === "paused" && (
                <button
                  onClick={resumeCampaignHandler}
                  className="rounded-lg bg-primary px-md py-sm text-label-md font-extrabold text-on-primary shadow-sm transition-opacity hover:opacity-95 cursor-pointer"
                >
                  Resume campaign
                </button>
              )}
              <button
                onClick={cancelCampaign}
                className="rounded-lg border border-outline bg-surface-container-low px-md py-sm text-label-md font-bold text-on-surface transition-colors hover:bg-surface-container cursor-pointer"
              >
                Cancel campaign
              </button>
            </div>
          )}
          {campaign.emails.length > 0 && (
            <div className="max-h-72 overflow-y-auto rounded-lg border border-outline/50">
              <table className="w-full border-collapse text-left text-body-sm">
                <thead className="sticky top-0 bg-surface-container border-b border-outline select-none">
                  <tr>
                    <th className="px-md py-sm text-[10px] font-bold uppercase tracking-wider text-on-surface-variant">Email Address</th>
                    <th className="px-md py-sm text-[10px] font-bold uppercase tracking-wider text-on-surface-variant">Status</th>
                    <th className="px-md py-sm text-[10px] font-bold uppercase tracking-wider text-on-surface-variant">Scheduled</th>
                    <th className="px-md py-sm text-[10px] font-bold uppercase tracking-wider text-on-surface-variant">Detail</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-outline/40">
                  {campaign.emails.map((e) => (
                    <tr key={e.email} className="hover:bg-surface-container/20">
                      <td className="px-md py-sm font-mono text-[11px] text-on-surface">{e.email}</td>
                      <td className="px-md py-sm select-none">
                        <span className={cn("rounded px-sm py-[2px] text-[10px] font-bold uppercase inline-block text-center", CAMPAIGN_EMAIL_STATUS_STYLES[e.status])}>
                          {e.status}
                        </span>
                      </td>
                      <td className="px-md py-sm font-mono text-[11px] text-on-surface-variant">
                        {new Date(e.scheduledAt).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })}
                      </td>
                      <td className="px-md py-sm text-xs text-on-surface-variant/90 leading-relaxed">
                        {e.error
                          ? e.error
                          : e.sentAt
                          ? `Sent ${new Date(e.sentAt).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })}`
                          : "Waiting for its scheduled slot"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {campaignError && (
        <div className="flex items-start gap-sm rounded-xl border border-red-500/20 bg-red-500/10 px-md py-sm text-body-sm text-red-400">
          <Icon name="error" className="text-[18px]" />
          <span>{campaignError}</span>
        </div>
      )}

      <div className="flex flex-wrap gap-xs">
        {(["now", "schedule"] as const).map((mode) => (
          <button
            key={mode}
            onClick={() => setSendMode(mode)}
            disabled={isSending}
            className={cn(
              "rounded-lg px-md py-sm text-xs font-bold uppercase transition-all border cursor-pointer",
              sendMode === mode
                ? "bg-primary/10 border-primary text-primary"
                : "bg-surface border-outline text-on-surface-variant hover:border-primary"
            )}
          >
            {mode === "now" ? "Send now (keep tab open)" : "Schedule background campaign"}
          </button>
        ))}
      </div>

      {sendMode === "schedule" ? (
        <div className="rounded-xl border border-outline bg-surface p-lg shadow-sm space-y-md">
          {renderSenderStatus()}
          <p className="text-xs text-on-surface-variant">
            Also requires <code className="font-mono text-xs bg-surface-container px-1.5 py-0.5 rounded font-bold">DATABASE_URL</code> configured server-side, plus an external cron pinging{" "}
            <code className="font-mono text-xs bg-surface-container px-1.5 py-0.5 rounded font-bold">/api/cron/tick</code> every minute.
          </p>
          <div className="pt-sm border-t border-outline/50">
            <span className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wider">Start</span>
            <div className="mt-sm flex flex-wrap gap-xs">
              {(["now", "at"] as const).map((mode) => (
                <button
                  key={mode}
                  onClick={() => setStartMode(mode)}
                  disabled={isSchedulingCampaign}
                  className={cn(
                    "rounded-lg px-md py-sm text-xs font-bold uppercase transition-all border cursor-pointer",
                    startMode === mode
                      ? "bg-primary/10 border-primary text-primary"
                      : "bg-surface border-outline text-on-surface-variant hover:border-primary"
                  )}
                >
                  {mode === "now" ? "Start now" : "Start at a specific time"}
                </button>
              ))}
            </div>
            {startMode === "at" && (
              <div className="mt-sm">
                <input
                  type="datetime-local"
                  value={startAtLocal}
                  onChange={(e) => setStartAtLocal(e.target.value)}
                  disabled={isSchedulingCampaign}
                  className="rounded-lg border border-outline bg-surface-container-low px-md py-sm text-body-sm text-on-surface font-mono"
                />
                <p className="mt-xs text-xs text-on-surface-variant font-medium">
                  Must be in the future. This persists on the server — it&apos;ll start at this time even if you close the browser or shut down your laptop before then.
                </p>
              </div>
            )}
          </div>
          <div className="pt-sm border-t border-outline/50">
            <span className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wider">Spread sends over</span>
            <div className="mt-sm flex items-center gap-sm">
              <input
                type="number"
                min={minCampaignHours}
                step="0.01"
                value={Math.round(effectiveDurationHours * 100) / 100}
                onChange={(e) => {
                  setDurationHours(Math.max(minCampaignHours, Number(e.target.value) || minCampaignHours));
                  setDurationTouched(true);
                }}
                disabled={isSchedulingCampaign}
                className="w-28 rounded-lg border border-outline bg-surface-container-low px-md py-sm text-body-sm text-on-surface font-mono"
              />
              <span className="text-body-sm text-on-surface-variant">hours (minimum {formatDurationHours(minCampaignHours)} for {drafts.length} email(s))</span>
            </div>
            <p className="mt-sm text-xs text-on-surface-variant font-medium">
              A small batch defaults to a quick, human-paced send rather than being stretched out — the minimum above already keeps a safe gap between sends. Sends are spaced evenly across whatever window you pick; if the hourly/daily cap is hit, remaining emails wait for the next opening rather than being dropped.
            </p>
            {renderWarmupNotice()}
          </div>
          <button
            onClick={scheduleCampaign}
            disabled={isSchedulingCampaign || drafts.length === 0 || draftsStale || startAtMissing || (campaign?.status === "running" || campaign?.status === "paused") || !settingsView?.configured}
            className="flex items-center gap-sm rounded-lg bg-primary px-lg py-md text-label-md font-extrabold text-on-primary shadow-lg shadow-primary/20 transition-all hover:scale-[1.02] active:scale-95 disabled:opacity-50 cursor-pointer"
          >
            <Icon name="schedule_send" className="text-[18px]" />
            {isSchedulingCampaign ? "Scheduling..." : `Schedule ${drafts.length} email(s) over ${formatDurationHours(effectiveDurationHours)}`}
          </button>
        </div>
      ) : (
      <div className="rounded-xl border border-outline bg-surface p-lg shadow-sm space-y-md">
        {renderSenderStatus()}

        <div className="pt-sm border-t border-outline/50">
          <span className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wider">Pacing Speed Configuration</span>
          <div className="mt-sm flex flex-wrap gap-xs">
            {(Object.keys(PACING_PRESETS) as PacingKey[]).map((key) => (
              <button
                key={key}
                onClick={() => setPacing(key)}
                disabled={isSending}
                className={cn(
                  "rounded-lg px-md py-sm text-xs font-bold uppercase transition-all border cursor-pointer",
                  pacing === key
                    ? "bg-primary/10 border-primary text-primary"
                    : "bg-surface border-outline text-on-surface-variant hover:border-primary"
                )}
              >
                {PACING_PRESETS[key].label} ({PACING_PRESETS[key].minSec}-{PACING_PRESETS[key].maxSec}s)
              </button>
            ))}
          </div>
          <p className="mt-sm text-xs text-on-surface-variant font-medium">{PACING_PRESETS[pacing].note}</p>
        </div>

        {sendPausedReason ? (
          <div className="flex items-start gap-sm rounded-lg border border-red-500/25 bg-red-500/10 px-md py-sm text-body-sm text-red-300">
            <Icon name="pause_circle" className="mt-0.5 text-[18px]" />
            <div className="flex-1 space-y-sm">
              <span>{sendPausedReason}</span>
              <div className="flex gap-sm">
                <button
                  onClick={resumeSend}
                  className="rounded-lg bg-primary px-md py-xs text-xs font-extrabold text-on-primary shadow-sm transition-opacity hover:opacity-95 cursor-pointer"
                >
                  Resume sending ({drafts.length - sendResults.length} left)
                </button>
                <button
                  onClick={dismissSendPause}
                  className="rounded-lg border border-outline bg-surface-container-low px-md py-xs text-xs font-bold text-on-surface transition-colors hover:bg-surface-container cursor-pointer"
                >
                  Dismiss
                </button>
              </div>
            </div>
          </div>
        ) : sendAutoResumeCountdown !== null && sendAutoResumeCountdown > 0 ? (
          <div className="flex items-center gap-sm rounded-lg border border-primary/30 bg-primary/10 px-md py-sm text-body-sm text-primary font-semibold animate-pulse">
            <Icon name="schedule" className="text-[18px]" />
            <span>
              Hourly send limit reached
              {rateLimitStatus ? ` (${rateLimitStatus.hourly.cap}/${rateLimitStatus.hourly.cap})` : ""}. Auto-resuming next batch in{" "}
              {Math.floor(sendAutoResumeCountdown / 60)}m {sendAutoResumeCountdown % 60}s... (queue remains active)
            </span>
          </div>
        ) : sendBlockedReason ? (
          <div className="flex items-start gap-sm rounded-lg border border-red-500/20 bg-red-500/10 px-md py-sm text-body-sm text-red-400">
            <Icon name="error" className="text-[18px]" />
            <span>{sendBlockedReason}</span>
          </div>
        ) : null}

        {isSending && (
          <div className="mt-lg pt-md border-t border-outline/50">
            <div className="mb-2 flex justify-between text-xs font-mono text-primary font-bold">
              <span>Outbox Dispatch Active...</span>
              <span>{sendProgress.done} / {sendProgress.total}</span>
            </div>
            <div className="h-2 w-full bg-surface-container rounded-full overflow-hidden">
              <motion.div
                className="h-full bg-primary"
                animate={{
                  width: sendProgress.total ? `${(sendProgress.done / sendProgress.total) * 100}%` : "0%"
                }}
                transition={{ duration: 0.2 }}
              />
            </div>
          </div>
        )}

        {rateLimitStatus && (
          <p className="text-xs font-mono text-on-surface-variant font-medium">
            {rateLimitStatus.hourly.remaining} sends left this hour · {rateLimitStatus.daily.remaining} left today
          </p>
        )}
        {renderWarmupNotice()}

        <div className="mt-md flex gap-md">
          <button
            onClick={startSend}
            disabled={isSending || !!sendPausedReason || drafts.length === 0 || draftsStale || (rateLimitStatus ? !rateLimitStatus.allowed : false) || !settingsView?.configured}
            title={
              draftsStale
                ? "Regenerate drafts to include newly-approved contacts before sending"
                : rateLimitStatus && !rateLimitStatus.allowed
                ? "Send rate limit reached"
                : undefined
            }
            className="flex items-center gap-sm rounded-lg bg-primary px-lg py-md text-label-md font-extrabold text-on-primary shadow-lg shadow-primary/20 transition-all hover:scale-[1.02] active:scale-95 disabled:opacity-50 cursor-pointer"
          >
            <Icon name="send" className="text-[18px]" />
            {isSending ? "Sending outbox..." : `Launch Outreach Run (${drafts.length})`}
          </button>
          {isSending && (
            <button
              onClick={stopSend}
              className="rounded-lg border border-outline bg-surface-container-low px-lg py-md text-label-md font-bold text-on-surface transition-colors hover:bg-surface-container cursor-pointer shadow-sm"
            >
              Stop queue run
            </button>
          )}
        </div>
      </div>
      )}

      {/* Display Paced Send Logs */}
      {sendResults.length > 0 && (
        <div className="overflow-hidden rounded-xl border border-outline bg-surface shadow-sm">
          <table className="w-full border-collapse text-left text-body-sm">
            <thead className="bg-surface-container border-b border-outline select-none">
              <tr>
                <th className="px-md py-md text-[10px] font-bold uppercase tracking-wider text-on-surface-variant">Email Address</th>
                <th className="px-md py-md text-[10px] font-bold uppercase tracking-wider text-on-surface-variant">Delivery</th>
                <th className="px-md py-md text-[10px] font-bold uppercase tracking-wider text-on-surface-variant">Log Outcome</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-outline/40">
              {sendResults.map((r) => (
                <tr key={r.email} className="hover:bg-surface-container/20">
                  <td className="px-md py-md font-mono text-[11px] text-on-surface">{r.email}</td>
                  <td className="px-md py-md select-none">
                    <span className={cn("rounded px-sm py-[2px] text-[10px] font-bold uppercase inline-block text-center", SEND_STATUS_STYLES[r.status])}>
                      {r.status}
                    </span>
                  </td>
                  <td className="px-md py-md text-xs text-on-surface-variant/90 leading-relaxed">{r.error || "Sent successfully (paced delay)"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
