"use client";

import { useCallback, useMemo } from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { Icon } from "@/components/icon";
import { StatusBadge } from "@/components/status-badge";
import { useValidatorChrome } from "../layout";
import { validateEmails } from "@/lib/groq-validator";
import { useValidatorStore, type EmailResult } from "@/lib/store";
import { cn } from "@/lib/utils";

export default function ValidatePage() {
  const router = useRouter();
  const { confirmAction } = useValidatorChrome();
  const { emails, results, isValidating, progress, setValidating, setProgress, appendResults, setError } =
    useValidatorStore();

  const latestResults = useMemo(() => results.slice(-5).reverse(), [results]);

  const startValidation = useCallback(async () => {
    setError(null);
    setValidating(true);
    setProgress(0, emails.length);
    try {
      const final = await validateEmails(emails, (done, total) => setProgress(done, total));
      appendResults(final);
      router.push("/validator/results");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Validation failed.");
    } finally {
      setValidating(false);
    }
  }, [emails, setValidating, setProgress, appendResults, setError, router]);

  const skipValidation = useCallback(async () => {
    const confirmed = await confirmAction(
      `Skip validation for all ${emails.length} contact(s)? They'll be marked valid without any local, MX/SMTP, or AI checks — you risk sending to broken or fake addresses.`,
      { title: "Skip validation?", confirmLabel: "Skip validation", tone: "warning" }
    );
    if (!confirmed) return;
    const skipped: EmailResult[] = emails.map((row) => ({
      ...row,
      status: "valid",
      reason: "Validation skipped by user",
    }));
    appendResults(skipped);
    router.push("/validator/results");
  }, [emails, appendResults, confirmAction, router]);

  return (
    <div className="space-y-lg">
      <div className="space-y-xs">
        <span className="text-[10px] font-bold text-primary uppercase tracking-wider">Stage 2 — Validate</span>
        <h1 className="text-headline-lg font-bold text-on-surface tracking-tight">Active Pipeline Validation</h1>
        <p className="text-body-md text-on-surface-variant">
          Local pre-filter format checks, disposable-domain filters, live MX &amp; SMTP check, and Groq AI review of ambiguous records.
        </p>
      </div>

      {/* Major Contact Count Card & Rail Progress */}
      <div className="rounded-2xl border border-outline bg-surface-container p-lg shadow-xl relative overflow-hidden">
        <div className="flex flex-col md:flex-row justify-between md:items-center gap-md mb-6">
          <div>
            <span className="text-[11px] font-bold uppercase tracking-wider text-primary">Target Queue</span>
            <div className="flex items-baseline gap-sm mt-xs">
              <h2 className="text-display-lg font-mono font-extrabold leading-none text-primary">
                {emails.length}
              </h2>
              <p className="text-body-md font-semibold text-on-surface">contacts ready for pipeline</p>
            </div>
          </div>

          <div className="flex items-center gap-sm">
            {isValidating ? (
              <button
                onClick={startValidation}
                disabled
                className="flex items-center gap-sm rounded-lg bg-primary/20 text-primary border border-primary/30 px-lg py-sm text-label-md font-bold cursor-not-allowed"
              >
                <Icon name="sync" className="animate-spin text-[18px]" />
                Validating...
              </button>
            ) : (
              <button
                onClick={startValidation}
                className="flex items-center gap-sm rounded-lg bg-primary px-lg py-sm text-label-md font-extrabold text-on-primary transition-all hover:scale-[1.02] active:scale-95 cursor-pointer shadow-md shadow-primary/20"
              >
                <Icon name="play_arrow" className="text-[18px] font-bold" />
                Start Validation
              </button>
            )}
            {!isValidating && (
              <button
                onClick={skipValidation}
                title="Mark every contact valid without running any checks"
                className="flex items-center gap-sm rounded-lg border border-outline bg-surface px-lg py-sm text-label-md font-bold text-on-surface-variant transition-colors hover:border-amber-400/50 hover:text-amber-400 cursor-pointer"
              >
                <Icon name="skip_next" className="text-[18px]" />
                Skip Validation
              </button>
            )}
          </div>
        </div>

        {/* Progress Signal Rail */}
        <div className="space-y-sm pt-4 border-t border-outline/50">
          <div className="flex justify-between items-center text-xs font-mono">
            <span className="text-on-surface-variant font-semibold">
              {isValidating ? "Validating contacts (MX / SMTP probes)..." : progress.done > 0 ? "Validation complete" : "Awaiting launch"}
            </span>
            <span className="text-primary font-bold">
              {progress.total ? Math.round((progress.done / progress.total) * 100) : 0}%
            </span>
          </div>

          {/* Horizontal progression rail */}
          <div className="relative w-full h-8 bg-surface rounded-lg border border-outline overflow-hidden flex items-center justify-between px-md select-none">
            {/* SVG track & pulse flow inside the bar */}
            <div className="absolute left-0 right-0 top-1/2 -translate-y-1/2 h-[3px] bg-outline-variant z-0 overflow-hidden">
              {isValidating && (
                <motion.div
                  className="h-full bg-primary"
                  animate={{
                    width: progress.total ? `${(progress.done / progress.total) * 100}%` : "0%"
                  }}
                  transition={{ duration: 0.3 }}
                />
              )}
            </div>

            <span className={cn("text-[9px] font-mono uppercase font-bold relative z-10", progress.done > 0 ? "text-primary" : "text-on-surface-variant")}>
              Local Filter
            </span>
            <span className={cn(
              "text-[9px] font-mono uppercase font-bold relative z-10 flex items-center gap-1",
              isValidating ? "text-primary font-extrabold animate-pulse" : progress.done > 0 ? "text-primary" : "text-on-surface-variant"
            )}>
              MX/SMTP PROBES
            </span>
            <span className={cn("text-[9px] font-mono uppercase font-bold relative z-10", progress.done === progress.total && progress.total > 0 ? "text-primary" : "text-on-surface-variant")}>
              AI Spaced Pass
            </span>
          </div>

          <div className="flex justify-between items-center text-[10px] text-on-surface-variant font-mono">
            <span>{progress.done} / {progress.total || emails.length} records processed</span>
            <span>{isValidating && "[Live validation stream active]"}</span>
          </div>
        </div>
      </div>

      {/* Live Feed: Waiting Feels Honest */}
      <div className="rounded-2xl border border-outline bg-surface p-lg shadow-sm space-y-md">
        <div className="flex justify-between items-center pb-2 border-b border-outline/50">
          <div>
            <span className="text-[10px] font-bold text-primary uppercase tracking-wider">Live stream</span>
            <h3 className="text-body-md font-bold text-on-surface">Validation stream — waiting feels honest</h3>
          </div>
          {isValidating && (
            <span className="text-[10px] font-mono text-red-400 bg-red-500/10 border border-red-500/20 px-2 py-0.5 rounded animate-pulse">
              Active run
            </span>
          )}
        </div>

        <div className="space-y-sm min-h-[140px] max-h-[220px] overflow-y-auto font-mono text-xs divide-y divide-outline/40">
          {latestResults.length > 0 ? (
            latestResults.map((r, index) => (
              <div key={r.email + index} className="flex items-center justify-between py-2 animate-fadeIn">
                <div className="flex items-center gap-sm">
                  <StatusBadge status={r.status} />
                  <span className="text-on-surface font-semibold">{r.email}</span>
                </div>
                <span className="text-on-surface-variant/75 text-[11px] truncate max-w-[320px]">{r.reason}</span>
              </div>
            ))
          ) : (
            <div className="flex flex-col items-center justify-center h-28 text-on-surface-variant">
              <Icon name="hourglass_empty" className="text-[24px] mb-2 opacity-50" />
              <span>No logs generated yet. Click Start Validation.</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
