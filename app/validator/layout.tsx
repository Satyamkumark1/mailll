"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSelectedLayoutSegment } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import { Icon } from "@/components/icon";
import { Logo } from "@/components/logo";
import { getSenderSettingsView, resetWarmupClient, saveSenderSettingsView, type SenderSettingsView } from "@/lib/settings-client";
import { useValidatorStore, type Tab } from "@/lib/store";
import { TABS } from "@/lib/tabs";
import { cn, computeDraftsStale } from "@/lib/utils";

export type ConfirmTone = "primary" | "warning" | "danger";

type ConfirmOptions = { title?: string; confirmLabel?: string; tone?: ConfirmTone };

type ConfirmRequest = {
  title: string;
  message: string;
  confirmLabel: string;
  tone: ConfirmTone;
  resolve: (value: boolean) => void;
};

const CONFIRM_TONE_STYLES: Record<ConfirmTone, { icon: string; iconBox: string; button: string }> = {
  primary: {
    icon: "help",
    iconBox: "border-primary/30 bg-primary/10 text-primary",
    button:
      "bg-primary text-on-primary shadow-sm transition-transform hover:scale-[1.02] active:scale-95 focus:outline-none focus:ring-2 focus:ring-primary/30",
  },
  warning: {
    icon: "warning",
    iconBox: "border-amber-500/30 bg-amber-500/10 text-amber-400",
    button:
      "bg-primary text-on-primary shadow-sm transition-transform hover:scale-[1.02] active:scale-95 focus:outline-none focus:ring-2 focus:ring-primary/30",
  },
  danger: {
    icon: "cancel",
    iconBox: "border-red-500/30 bg-red-500/10 text-red-400",
    button:
      "border border-red-500/25 bg-red-500/10 text-red-300 transition-colors hover:bg-red-500/20 focus:outline-none focus:ring-2 focus:ring-red-400/30",
  },
};

// Any in-page navigation that should be intercepted (currently: leaving the
// Draft page with unsaved edits) registers itself here. `run` performs the
// actual navigation/reset once the user has resolved the prompt (or
// immediately, if the registering page decides nothing needs confirming).
type GuardedAction = (description: string, run: () => void) => void;

interface ValidatorChrome {
  confirmAction: (message: string, options?: ConfirmOptions) => Promise<boolean>;
  settingsView: SenderSettingsView | null;
  refreshSettingsView: () => Promise<void>;
  openSettings: () => void;
  setGuardedAction: (fn: GuardedAction | null) => void;
}

const ValidatorChromeContext = createContext<ValidatorChrome | null>(null);

export function useValidatorChrome() {
  const ctx = useContext(ValidatorChromeContext);
  if (!ctx) throw new Error("useValidatorChrome must be used within app/validator/layout.tsx");
  return ctx;
}

export default function ValidatorLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const segment = useSelectedLayoutSegment() as Tab | null;

  const { emails, results, drafts, sendResults, activeCampaignId, isValidating, isSending, error, reset } =
    useValidatorStore();
  const validContacts = useMemo(() => results.filter((r) => r.status === "valid"), [results]);
  const draftsStale = useMemo(() => computeDraftsStale(validContacts, drafts), [validContacts, drafts]);

  const tabEnabled = useCallback(
    (tab: Tab) => {
      if (tab === "upload") return true;
      if (tab === "history") return true;
      if (tab === "validate") return emails.length > 0;
      if (tab === "draft") return validContacts.length > 0;
      // History's "View" can send you here to check a campaign scheduled
      // from a different browser/session, with no local drafts at all —
      // that's still a legitimate reason to land on Send.
      if (tab === "send") return (drafts.length > 0 && !draftsStale) || Boolean(activeCampaignId);
      return results.length > 0;
    },
    [emails.length, validContacts.length, drafts.length, draftsStale, results.length, activeCampaignId]
  );

  const stageComplete: Record<Tab, boolean> = {
    upload: emails.length > 0,
    validate: results.length > 0,
    results: results.length > 0,
    draft: drafts.length > 0,
    send: sendResults.length > 0,
    export: false,
    history: false,
  };

  // A bookmarked/refreshed URL for a stage that isn't reachable yet (the
  // store has no persistence, so a refresh can land here with none of the
  // data that stage needs) bounces back to Upload — the same rule that
  // grayed out its tab button, now also enforced against direct URL entry.
  useEffect(() => {
    if (segment && !tabEnabled(segment)) {
      router.replace("/validator/upload");
    }
  }, [segment, tabEnabled, router]);

  const [guardedAction, setGuardedAction] = useState<GuardedAction | null>(null);

  // Custom stand-in for window.confirm — native browser confirm dialogs
  // can't be styled and look jarring against the app's dark theme.
  const [confirmRequest, setConfirmRequest] = useState<ConfirmRequest | null>(null);
  const confirmAction = useCallback(
    (message: string, options?: ConfirmOptions) =>
      new Promise<boolean>((resolve) => {
        setConfirmRequest({
          title: options?.title ?? "Are you sure?",
          message,
          confirmLabel: options?.confirmLabel ?? "Continue",
          tone: options?.tone ?? "primary",
          resolve,
        });
      }),
    []
  );

  const [settingsView, setSettingsView] = useState<SenderSettingsView | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsForm, setSettingsForm] = useState({
    smtpHost: "",
    smtpPort: 465,
    smtpUser: "",
    smtpPassword: "",
    hourlyCap: 35,
    dailyCap: 150,
    warmupEnabled: true,
  });
  const [settingsError, setSettingsError] = useState<string | null>(null);
  const [settingsWarning, setSettingsWarning] = useState<string | null>(null);
  const [isSavingSettings, setIsSavingSettings] = useState(false);
  const [isResettingWarmup, setIsResettingWarmup] = useState(false);

  const refreshSettingsView = useCallback(() => {
    return getSenderSettingsView()
      .then(setSettingsView)
      .catch(() => {});
  }, []);

  useEffect(() => {
    refreshSettingsView();
  }, [refreshSettingsView]);

  const openSettings = useCallback(() => {
    if (settingsView) {
      setSettingsForm({
        smtpHost: settingsView.smtpHost,
        smtpPort: settingsView.smtpPort,
        smtpUser: settingsView.smtpUser,
        smtpPassword: "",
        hourlyCap: settingsView.hourlyCap,
        dailyCap: settingsView.dailyCap,
        warmupEnabled: settingsView.warmupEnabled,
      });
    }
    setSettingsError(null);
    setSettingsWarning(null);
    setSettingsOpen(true);
  }, [settingsView]);

  const saveSettings = useCallback(async () => {
    setIsSavingSettings(true);
    setSettingsError(null);
    setSettingsWarning(null);
    try {
      const { warning } = await saveSenderSettingsView({
        smtpHost: settingsForm.smtpHost,
        smtpPort: settingsForm.smtpPort,
        smtpUser: settingsForm.smtpUser,
        smtpPassword: settingsForm.smtpPassword || undefined,
        hourlyCap: settingsForm.hourlyCap,
        dailyCap: settingsForm.dailyCap,
        warmupEnabled: settingsForm.warmupEnabled,
      });
      setSettingsWarning(warning);
      await refreshSettingsView();
      if (!warning) setSettingsOpen(false);
    } catch (err) {
      setSettingsError(err instanceof Error ? err.message : "Failed to save settings");
    } finally {
      setIsSavingSettings(false);
    }
  }, [settingsForm, refreshSettingsView]);

  const handleResetWarmup = useCallback(async () => {
    const confirmed = await confirmAction(
      "Restart the warm-up ramp from the floor? Use this after a Zoho block clears.",
      { title: "Restart warm-up ramp?", confirmLabel: "Restart warm-up", tone: "warning" }
    );
    if (!confirmed) return;
    setIsResettingWarmup(true);
    try {
      await resetWarmupClient();
      await refreshSettingsView();
    } catch (err) {
      setSettingsError(err instanceof Error ? err.message : "Failed to reset warm-up");
    } finally {
      setIsResettingWarmup(false);
    }
  }, [refreshSettingsView, confirmAction]);

  const groqConnected = Boolean(process.env.NEXT_PUBLIC_GROQ_API_KEY);

  const handleStartOver = () => {
    const run = () => {
      reset();
      router.push("/validator/upload");
    };
    if (guardedAction) guardedAction("start over", run);
    else run();
  };

  const chrome = useMemo<ValidatorChrome>(
    () => ({ confirmAction, settingsView, refreshSettingsView, openSettings, setGuardedAction }),
    [confirmAction, settingsView, refreshSettingsView, openSettings]
  );

  return (
    <ValidatorChromeContext.Provider value={chrome}>
      <div className="h-screen w-full bg-background flex items-center justify-center font-sans overflow-hidden">
        <div className="w-full h-full bg-background text-on-surface flex flex-col overflow-hidden relative">

          {/* Top Header */}
          <header className="flex h-16 shrink-0 items-center justify-between border-b border-outline bg-surface px-md lg:px-lg select-none">
            <Logo size="sm" />

            <div className="flex items-center gap-md">
              {groqConnected ? (
                <span className="hidden sm:inline-flex items-center gap-1.5 text-xs text-primary font-mono bg-primary/10 border border-primary/20 px-2.5 py-1 rounded-full">
                  <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
                  Groq AI Online
                </span>
              ) : (
                <span className="hidden sm:inline-flex items-center gap-1.5 text-xs text-red-400 font-mono bg-red-500/10 border border-red-500/20 px-2.5 py-1 rounded-full">
                  <span className="w-1.5 h-1.5 rounded-full bg-red-500" />
                  AI Key Missing
                </span>
              )}

              {(emails.length > 0 || results.length > 0) && (
                <button
                  onClick={handleStartOver}
                  className="flex items-center gap-xs rounded-lg border border-outline bg-surface-container-low px-md py-sm text-label-md font-bold text-on-surface transition-all hover:bg-surface-container hover:text-primary active:scale-95 cursor-pointer shadow-sm"
                >
                  <Icon name="refresh" className="text-[16px] text-primary" />
                  Start Over
                </button>
              )}

              <button
                onClick={openSettings}
                title="Sender settings"
                className="flex h-9 w-9 items-center justify-center rounded-lg border border-outline bg-surface-container-low text-on-surface-variant transition-all hover:bg-surface-container hover:text-primary active:scale-95 cursor-pointer shadow-sm"
              >
                <Icon name="settings" className="text-[18px]" />
              </button>

              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary text-on-primary font-extrabold text-xs shadow-md select-none">
                JD
              </div>
            </div>
          </header>

          {/* Workspace Body - Contains Stepper Rail + Stages */}
          <div className="flex-1 flex flex-col min-h-0 relative">

            {/* Top Stage Navigation Stepper (Horizontal signal rail style) */}
            <div className="w-full bg-surface-container-lowest border-b border-outline py-4 px-md select-none shrink-0">
              <div className="max-w-4xl mx-auto relative flex justify-between items-center px-4">

                {/* Stepper connecting rail (quieter signal path) */}
                <div className="absolute left-6 right-6 top-1/2 -translate-y-1/2 h-[2px] bg-outline z-0 overflow-hidden">
                  {(isValidating || isSending) && (
                    <div className="absolute inset-0 bg-primary/25 animate-signal-flow w-full h-full" style={{ strokeDasharray: "6 6" }} />
                  )}
                </div>

                {TABS.map((tab) => {
                  const active = segment === tab.id;
                  const enabled = tabEnabled(tab.id);
                  const complete = stageComplete[tab.id];

                  const badge = (
                    <>
                      <motion.div
                        className={cn(
                          "w-8 h-8 rounded-full border-2 flex items-center justify-center transition-all",
                          active
                            ? "bg-primary border-primary text-on-primary shadow-[0_0_10px_rgba(163,230,53,0.5)]"
                            : complete
                            ? "bg-surface border-primary text-primary"
                            : enabled
                            ? "bg-surface border-outline text-on-surface-variant group-hover:border-primary group-hover:text-primary"
                            : "bg-surface-container border-outline-variant text-on-surface-variant/40"
                        )}
                        animate={active ? { scale: 1.1 } : { scale: 1.0 }}
                      >
                        {complete && !active ? (
                          <Icon name="check" className="text-[16px] font-extrabold" />
                        ) : (
                          <Icon name={tab.icon} className="text-[14px]" />
                        )}
                      </motion.div>

                      <span className={cn(
                        "absolute top-10 text-[9px] uppercase font-bold tracking-wider whitespace-nowrap",
                        active ? "text-primary font-extrabold" : enabled ? "text-on-surface-variant group-hover:text-on-surface" : "text-on-surface-variant/30"
                      )}>
                        {tab.label}
                      </span>
                    </>
                  );

                  if (!enabled) {
                    return (
                      <span key={tab.id} className="relative z-10 flex flex-col items-center cursor-not-allowed focus:outline-none">
                        {badge}
                      </span>
                    );
                  }

                  return (
                    <Link
                      key={tab.id}
                      href={`/validator/${tab.id}`}
                      onNavigate={(e) => {
                        if (active) {
                          e.preventDefault();
                          return;
                        }
                        if (guardedAction) {
                          e.preventDefault();
                          guardedAction(`go to ${tab.label}`, () => router.push(`/validator/${tab.id}`));
                        }
                      }}
                      className="relative z-10 flex flex-col items-center group cursor-pointer focus:outline-none"
                    >
                      {badge}
                    </Link>
                  );
                })}
              </div>
              {/* Added spacer to prevent collision with step labels */}
              <div className="h-4" />
            </div>

            {/* Main workspace container */}
            <main className="flex-1 overflow-y-auto p-md lg:p-lg pb-24 md:pb-lg min-h-0 bg-background">
              <div className="mx-auto max-w-5xl space-y-lg">

                {error && (
                  <div className="flex items-start gap-sm rounded-xl border border-error/25 bg-error-container/20 p-md text-body-sm text-on-error-container">
                    <Icon name="error" className="text-[20px] text-error" />
                    <div>
                      <span className="font-bold block mb-0.5">Pipeline Alert</span>
                      <span>{error}</span>
                    </div>
                  </div>
                )}

                <AnimatePresence mode="wait">
                  <motion.div
                    key={segment}
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -6 }}
                    transition={{ duration: 0.15 }}
                  >
                    {children}
                  </motion.div>
                </AnimatePresence>
              </div>
            </main>
          </div>

          {settingsOpen && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/75 p-md backdrop-blur-sm" role="presentation">
              <div role="dialog" aria-modal="true" aria-labelledby="settings-title" className="w-full max-w-[32rem] max-h-[85vh] overflow-y-auto rounded-2xl border border-outline bg-surface p-lg shadow-2xl space-y-md">
                <div className="flex items-center justify-between">
                  <h2 id="settings-title" className="text-headline-md font-bold text-on-surface">Sender Settings</h2>
                  <button onClick={() => setSettingsOpen(false)} className="text-on-surface-variant hover:text-on-surface cursor-pointer">
                    <Icon name="close" className="text-[20px]" />
                  </button>
                </div>

                {settingsError && (
                  <div className="flex items-start gap-sm rounded-lg border border-red-500/20 bg-red-500/10 px-md py-sm text-body-sm text-red-400">
                    <Icon name="error" className="text-[18px]" />
                    <span>{settingsError}</span>
                  </div>
                )}
                {settingsWarning && (
                  <div className="flex items-start gap-sm rounded-lg border border-amber-500/25 bg-amber-500/10 px-md py-sm text-body-sm text-amber-200">
                    <Icon name="warning" className="text-[18px]" />
                    <span>{settingsWarning}</span>
                  </div>
                )}

                <div className="space-y-sm">
                  <span className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wider">SMTP Account</span>
                  <div className="grid grid-cols-2 gap-sm">
                    <label className="col-span-2 flex flex-col gap-xs">
                      <span className="text-xs text-on-surface-variant font-semibold">Host</span>
                      <input
                        type="text"
                        value={settingsForm.smtpHost}
                        onChange={(e) => setSettingsForm({ ...settingsForm, smtpHost: e.target.value })}
                        placeholder="smtp.zoho.in"
                        className="rounded-lg border border-outline bg-surface-container-low px-md py-sm text-body-sm text-on-surface font-mono"
                      />
                    </label>
                    <label className="flex flex-col gap-xs">
                      <span className="text-xs text-on-surface-variant font-semibold">Port</span>
                      <input
                        type="number"
                        value={settingsForm.smtpPort}
                        onChange={(e) => setSettingsForm({ ...settingsForm, smtpPort: Number(e.target.value) || 465 })}
                        className="rounded-lg border border-outline bg-surface-container-low px-md py-sm text-body-sm text-on-surface font-mono"
                      />
                    </label>
                    <label className="flex flex-col gap-xs">
                      <span className="text-xs text-on-surface-variant font-semibold">User (from-address)</span>
                      <input
                        type="text"
                        value={settingsForm.smtpUser}
                        onChange={(e) => setSettingsForm({ ...settingsForm, smtpUser: e.target.value })}
                        placeholder="hello@yourcompany.com"
                        className="rounded-lg border border-outline bg-surface-container-low px-md py-sm text-body-sm text-on-surface font-mono"
                      />
                    </label>
                    <label className="col-span-2 flex flex-col gap-xs">
                      <span className="text-xs text-on-surface-variant font-semibold">Password</span>
                      <input
                        type="password"
                        value={settingsForm.smtpPassword}
                        onChange={(e) => setSettingsForm({ ...settingsForm, smtpPassword: e.target.value })}
                        placeholder={settingsView?.hasPassword ? "•••••••• (leave blank to keep current)" : "required"}
                        className="rounded-lg border border-outline bg-surface-container-low px-md py-sm text-body-sm text-on-surface font-mono"
                      />
                    </label>
                  </div>
                </div>

                <div className="space-y-sm pt-sm border-t border-outline/50">
                  <span className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wider">Send Limits</span>
                  <p className="text-xs text-on-surface-variant">
                    Zoho&apos;s external sending is reputation-based, dynamically capped at 50-500/hr — going above 50 without an established sending history risks another block; 500 is Zoho&apos;s documented absolute ceiling.
                  </p>
                  <div className="grid grid-cols-2 gap-sm">
                    <label className="flex flex-col gap-xs">
                      <span className="text-xs text-on-surface-variant font-semibold">Hourly cap</span>
                      <input
                        type="number"
                        value={settingsForm.hourlyCap}
                        onChange={(e) => setSettingsForm({ ...settingsForm, hourlyCap: Number(e.target.value) || 1 })}
                        className="rounded-lg border border-outline bg-surface-container-low px-md py-sm text-body-sm text-on-surface font-mono"
                      />
                    </label>
                    <label className="flex flex-col gap-xs">
                      <span className="text-xs text-on-surface-variant font-semibold">Daily cap</span>
                      <input
                        type="number"
                        value={settingsForm.dailyCap}
                        onChange={(e) => setSettingsForm({ ...settingsForm, dailyCap: Number(e.target.value) || 1 })}
                        className="rounded-lg border border-outline bg-surface-container-low px-md py-sm text-body-sm text-on-surface font-mono"
                      />
                    </label>
                  </div>
                  {settingsForm.hourlyCap > 50 && (
                    <p className="text-xs text-amber-300 font-semibold">Above Zoho&apos;s 50/hr reputation-based low end — safe for an established account, risky otherwise.</p>
                  )}
                </div>

                <div className="space-y-sm pt-sm border-t border-outline/50">
                  <span className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wider">Warm-up</span>
                  <p className="text-xs text-on-surface-variant">
                    Following Zoho&apos;s own guidance to ramp volume up gradually: when enabled, actual sending starts well below your caps above and increases to them over ~14 days, rather than sending at full volume from day one.
                  </p>
                  <label className="flex items-center gap-sm">
                    <input
                      type="checkbox"
                      checked={settingsForm.warmupEnabled}
                      onChange={(e) => setSettingsForm({ ...settingsForm, warmupEnabled: e.target.checked })}
                      className="h-4 w-4"
                    />
                    <span className="text-body-sm text-on-surface">Warm-up enabled</span>
                  </label>
                  {settingsView?.effective.warmupActive && (
                    <p className="text-xs font-mono text-primary font-semibold">
                      Currently: {settingsView.effective.hourlyCap}/{settingsView.effective.hourlyTarget} per hour (day {settingsView.effective.warmupDay} of {settingsView.effective.warmupDays})
                    </p>
                  )}
                  <button
                    onClick={handleResetWarmup}
                    disabled={isResettingWarmup || !settingsView?.configured}
                    className="rounded-lg border border-outline bg-surface-container-low px-md py-sm text-xs font-bold text-on-surface transition-colors hover:bg-surface-container cursor-pointer disabled:opacity-50"
                  >
                    {isResettingWarmup ? "Resetting..." : "Reset warm-up (restart ramp from the floor)"}
                  </button>
                </div>

                <div className="flex justify-end gap-sm pt-sm">
                  <button
                    onClick={() => setSettingsOpen(false)}
                    className="rounded-lg border border-outline bg-surface-container-low px-md py-sm text-label-md font-bold text-on-surface-variant transition-colors hover:text-on-surface cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={saveSettings}
                    disabled={isSavingSettings}
                    className="rounded-lg bg-primary px-md py-sm text-label-md font-extrabold text-on-primary shadow-sm transition-transform hover:scale-[1.02] active:scale-95 cursor-pointer disabled:opacity-50"
                  >
                    {isSavingSettings ? "Saving..." : "Save"}
                  </button>
                </div>
              </div>
            </div>
          )}

          {confirmRequest && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/75 p-md backdrop-blur-sm" role="presentation">
              <div role="dialog" aria-modal="true" aria-labelledby="confirm-title" className="w-full max-w-[28rem] rounded-2xl border border-outline bg-surface p-lg shadow-2xl">
                <div className={cn("flex h-10 w-10 items-center justify-center rounded-xl border", CONFIRM_TONE_STYLES[confirmRequest.tone].iconBox)}>
                  <Icon name={CONFIRM_TONE_STYLES[confirmRequest.tone].icon} className="text-[21px]" />
                </div>
                <h2 id="confirm-title" className="mt-md text-headline-md font-bold text-on-surface">{confirmRequest.title}</h2>
                <p className="mt-xs text-body-sm leading-relaxed text-on-surface-variant">{confirmRequest.message}</p>
                <div className="mt-lg flex flex-col-reverse gap-sm sm:flex-row sm:justify-end">
                  <button
                    onClick={() => {
                      confirmRequest.resolve(false);
                      setConfirmRequest(null);
                    }}
                    className="rounded-lg border border-outline bg-surface-container-low px-md py-sm text-label-md font-bold text-on-surface-variant transition-colors hover:text-on-surface focus:outline-none focus:ring-2 focus:ring-primary/30"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={() => {
                      confirmRequest.resolve(true);
                      setConfirmRequest(null);
                    }}
                    className={cn("rounded-lg px-md py-sm text-label-md font-extrabold cursor-pointer", CONFIRM_TONE_STYLES[confirmRequest.tone].button)}
                  >
                    {confirmRequest.confirmLabel}
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </ValidatorChromeContext.Provider>
  );
}
