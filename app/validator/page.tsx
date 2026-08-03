"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Icon } from "@/components/icon";
import { Logo } from "@/components/logo";
import { generateDrafts } from "@/lib/draft-generator";
import { getSendRateStatus, sendDraftsPaced } from "@/lib/email-sender";
import { buildSignatureHtml } from "@/lib/email-signature";
import { validateEmails } from "@/lib/groq-validator";
import {
  ELEVIQUE_OUTREACH_CONFIG,
  useValidatorStore,
  type EmailResult,
  type EmailStatus,
  type OutreachConfig,
  type SendStatus,
  type Tab,
  type Tone,
} from "@/lib/store";
import { TABS } from "@/lib/tabs";
import { cn, computeDraftsStale, downloadCsv, downloadTextFile, draftsToCsv, parseEmailCsv, resultsToCsv, type ParsedCsv } from "@/lib/utils";

const TONES: Tone[] = ["casual", "formal", "in-between"];

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

type PendingDraftAction = {
  description: string;
  run: () => void;
};

export default function Home() {
  const store = useValidatorStore();
  const {
    activeTab, emails, results, isValidating, progress, error,
    drafts, isDrafting, draftProgress, draftError, outreachConfig,
    sendResults, isSending, sendProgress, rateLimitStatus, sendBlockedReason, sendAutoResumeCountdown,
    setActiveTab, setEmails, setValidating, setProgress, appendResults, markResultValid, markAllFlaggedValid, markAllInvalidValid, setError, reset,
    setOutreachConfig, setDrafting, setDraftProgress, appendDrafts, setDraftError, clearDrafts, updateDraft,
    setSending, setSendProgress, appendSendResults, clearSendResults, setRateLimitStatus, setSendBlockedReason, setSendAutoResumeCountdown,
  } = store;

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [fileName, setFileName] = useState<string | null>(null);
  const [filter, setFilter] = useState<EmailStatus | "all">("all");
  const [resultsSearch, setResultsSearch] = useState("");
  const [parseInfo, setParseInfo] = useState<ParsedCsv | null>(null);
  const [copiedEmail, setCopiedEmail] = useState<string | null>(null);
  const [pacing, setPacing] = useState<PacingKey>("cautious");
  const cancelSendRef = useRef(false);
  const [singleEmail, setSingleEmail] = useState("");
  const [singleResult, setSingleResult] = useState<EmailResult | null>(null);
  const [isCheckingSingle, setIsCheckingSingle] = useState(false);
  const [draftView, setDraftView] = useState<"setup" | "editor">("setup");
  const [selectedDraftEmail, setSelectedDraftEmail] = useState<string | null>(null);
  const [editorSubject, setEditorSubject] = useState("");
  const [editorBody, setEditorBody] = useState("");
  const [editorError, setEditorError] = useState<string | null>(null);
  const [editorSaved, setEditorSaved] = useState(false);
  const [pendingDraftAction, setPendingDraftAction] = useState<PendingDraftAction | null>(null);
  const saveStatusTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const summary = useMemo(() => {
    const valid = results.filter((r) => r.status === "valid").length;
    const invalid = results.filter((r) => r.status === "invalid").length;
    const flagged = results.filter((r) => r.status === "flagged").length;
    return { valid, invalid, flagged, total: results.length };
  }, [results]);

  const filteredResults = useMemo(() => {
    const byStatus = filter === "all" ? results : results.filter((r) => r.status === filter);
    const q = resultsSearch.trim().toLowerCase();
    if (!q) return byStatus;
    return byStatus.filter(
      (r) => r.brand.toLowerCase().includes(q) || r.email.toLowerCase().includes(q) || r.pocName.toLowerCase().includes(q)
    );
  }, [results, filter, resultsSearch]);

  const validContacts = useMemo(() => results.filter((r) => r.status === "valid"), [results]);
  const draftsStale = useMemo(() => computeDraftsStale(validContacts, drafts), [validContacts, drafts]);
  const selectedDraft = useMemo(
    () => drafts.find((draft) => draft.email === selectedDraftEmail) ?? null,
    [drafts, selectedDraftEmail]
  );
  const selectedDraftIndex = selectedDraft ? drafts.findIndex((draft) => draft.email === selectedDraft.email) : -1;
  const signatureHtml = useMemo(
    () => buildSignatureHtml(outreachConfig, "/elevique-logo.png"),
    [outreachConfig]
  );
  const isDraftDirty = Boolean(
    selectedDraft && (editorSubject !== selectedDraft.subject || editorBody !== selectedDraft.body)
  );

  const handleFile = useCallback(
    async (file: File) => {
      setError(null);
      try {
        const parsed = await parseEmailCsv(file);
        if (parsed.rows.length === 0) {
          setError("No email addresses found in that CSV.");
          return;
        }
        setFileName(file.name);
        setParseInfo(parsed);
        setEmails(parsed.rows);
        setActiveTab("validate");
      } catch {
        setError("Couldn't parse that CSV file.");
      }
    },
    [setEmails, setActiveTab, setError]
  );

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragging(false);
      const file = e.dataTransfer.files[0];
      if (file) handleFile(file);
    },
    [handleFile]
  );

  const startValidation = useCallback(async () => {
    setError(null);
    setValidating(true);
    setProgress(0, emails.length);
    try {
      const final = await validateEmails(emails, (done, total) => setProgress(done, total));
      appendResults(final);
      setActiveTab("results");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Validation failed.");
    } finally {
      setValidating(false);
    }
  }, [emails, setValidating, setProgress, appendResults, setActiveTab, setError]);

  const checkSingleEmail = useCallback(async () => {
    const email = singleEmail.trim();
    if (!email) return;
    setError(null);
    setSingleResult(null);
    setIsCheckingSingle(true);
    try {
      const row = { email, brand: "", category: "", linkedinUrl: "", pocName: "", pocDesignation: "" };
      const [result] = await validateEmails([row], () => {});
      setSingleResult(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Validation failed.");
    } finally {
      setIsCheckingSingle(false);
    }
  }, [singleEmail, setError]);

  const generateDraftsHandler = useCallback(async () => {
    if (drafts.length > 0) {
      const confirmed = window.confirm(
        "Generating a new draft set will replace all current drafts, including any manual edits. Continue?"
      );
      if (!confirmed) return;
    }
    setDraftError(null);
    clearDrafts();
    setDraftView("setup");
    setSelectedDraftEmail(null);
    setDrafting(true);
    setDraftProgress(0, validContacts.length);
    try {
      const final = await generateDrafts(validContacts, outreachConfig, (done, total) =>
        setDraftProgress(done, total)
      );
      appendDrafts(final);
      if (final[0]) {
        setSelectedDraftEmail(final[0].email);
        setEditorSubject(final[0].subject);
        setEditorBody(final[0].body);
        setEditorError(null);
        setEditorSaved(false);
        setDraftView("editor");
      }
    } catch (err) {
      setDraftError(err instanceof Error ? err.message : "Draft generation failed.");
    } finally {
      setDrafting(false);
    }
  }, [drafts, validContacts, outreachConfig, setDraftError, clearDrafts, setDrafting, setDraftProgress, appendDrafts]);

  const copyDraft = useCallback(
    (email: string, subject: string, body: string) => {
      navigator.clipboard.writeText(`Subject: ${subject}\n\n${body}`).then(
        () => {
          setCopiedEmail(email);
          setTimeout(() => setCopiedEmail((current) => (current === email ? null : current)), 2000);
        },
        () => setDraftError("Couldn't copy to clipboard — your browser may be blocking clipboard access.")
      );
    },
    [setDraftError]
  );

  const openDraftEditor = useCallback((email: string) => {
    const draft = drafts.find((item) => item.email === email);
    if (!draft) return;
    setSelectedDraftEmail(draft.email);
    setEditorSubject(draft.subject);
    setEditorBody(draft.body);
    setEditorError(null);
    setEditorSaved(false);
    setDraftView("editor");
  }, [drafts]);

  const discardDraftChanges = useCallback(() => {
    if (!selectedDraft) return;
    setEditorSubject(selectedDraft.subject);
    setEditorBody(selectedDraft.body);
    setEditorError(null);
    setEditorSaved(false);
  }, [selectedDraft]);

  const saveDraftChanges = useCallback(() => {
    if (!selectedDraft) return false;
    if (!editorSubject.trim() || !editorBody.trim()) {
      setEditorError("Subject and message can't be empty.");
      return false;
    }

    updateDraft(selectedDraft.email, { subject: editorSubject, body: editorBody });
    setEditorError(null);
    setEditorSaved(true);
    if (saveStatusTimerRef.current) clearTimeout(saveStatusTimerRef.current);
    saveStatusTimerRef.current = setTimeout(() => setEditorSaved(false), 2200);
    return true;
  }, [editorBody, editorSubject, selectedDraft, updateDraft]);

  const requestDraftAction = useCallback(
    (description: string, run: () => void) => {
      if (isDraftDirty) {
        setPendingDraftAction({ description, run });
        return;
      }
      run();
    },
    [isDraftDirty]
  );

  const resolvePendingDraftAction = useCallback(
    (resolution: "save" | "discard") => {
      if (!pendingDraftAction) return;
      if (resolution === "save" && !saveDraftChanges()) {
        setPendingDraftAction(null);
        return;
      }
      if (resolution === "discard") discardDraftChanges();
      const action = pendingDraftAction.run;
      setPendingDraftAction(null);
      action();
    },
    [discardDraftChanges, pendingDraftAction, saveDraftChanges]
  );

  const updateConfig = useCallback(
    (patch: Partial<OutreachConfig>) => setOutreachConfig({ ...outreachConfig, ...patch }),
    [outreachConfig, setOutreachConfig]
  );

  const configComplete =
    outreachConfig.senderName.trim() &&
    outreachConfig.company.trim() &&
    outreachConfig.pitch.trim() &&
    outreachConfig.cta.trim() &&
    outreachConfig.signature.trim() &&
    outreachConfig.businessAddress.trim() &&
    outreachConfig.title.trim() &&
    outreachConfig.mobile.trim() &&
    outreachConfig.contactEmail.trim() &&
    outreachConfig.website.trim();

  useEffect(() => {
    if (activeTab === "send") {
      getSendRateStatus().then(setRateLimitStatus).catch(() => {});
    }
  }, [activeTab, setRateLimitStatus]);

  const startSend = useCallback(async () => {
    const { minSec, maxSec } = PACING_PRESETS[pacing];
    const totalMinSec = drafts.length * minSec;
    const totalMaxSec = drafts.length * maxSec;
    const durationEstimate =
      totalMaxSec < 60
        ? `${totalMinSec}-${totalMaxSec}s`
        : `${Math.round(totalMinSec / 60)}-${Math.round(totalMaxSec / 60)} min`;
    const confirmed = window.confirm(
      `This will send ${drafts.length} real email(s) from your Gmail account, paced ${minSec}-${maxSec}s apart ` +
        `(roughly ${durationEstimate} total). This cannot be undone once sent. Continue?`
    );
    if (!confirmed) return;

    clearSendResults();
    setSending(true);
    setSendProgress(0, drafts.length);
    cancelSendRef.current = false;

    await sendDraftsPaced(
      drafts,
      outreachConfig,
      minSec * 1000,
      maxSec * 1000,
      (done, total) => setSendProgress(done, total),
      (result) => appendSendResults([result]),
      () => cancelSendRef.current,
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
      }
    );

    setSending(false);
    setSendAutoResumeCountdown(null);
    getSendRateStatus().then(setRateLimitStatus).catch(() => {});
  }, [
    drafts,
    outreachConfig,
    pacing,
    setSending,
    setSendProgress,
    appendSendResults,
    clearSendResults,
    setSendBlockedReason,
    setRateLimitStatus,
    setSendAutoResumeCountdown,
  ]);

  const stopSend = useCallback(() => {
    cancelSendRef.current = true;
    setSendAutoResumeCountdown(null);
    getSendRateStatus().then(setRateLimitStatus).catch(() => {});
  }, [setRateLimitStatus, setSendAutoResumeCountdown]);

  const tabEnabled = (tab: Tab) => {
    if (tab === "upload") return true;
    if (tab === "validate") return emails.length > 0;
    if (tab === "draft") return validContacts.length > 0;
    if (tab === "send") return drafts.length > 0 && !draftsStale;
    return results.length > 0;
  };

  const stageComplete: Record<Tab, boolean> = {
    upload: emails.length > 0,
    validate: results.length > 0,
    results: results.length > 0,
    draft: drafts.length > 0,
    send: sendResults.length > 0,
    export: false,
  };

  const groqConnected = Boolean(process.env.NEXT_PUBLIC_GROQ_API_KEY);

  const performStartOver = () => {
    reset();
    setFileName(null);
    setFilter("all");
    setResultsSearch("");
    setParseInfo(null);
    setDraftView("setup");
    setSelectedDraftEmail(null);
    setEditorSubject("");
    setEditorBody("");
    setEditorError(null);
    setEditorSaved(false);
  };

  const handleStartOver = () => requestDraftAction("start over", performStartOver);

  const requestTabChange = (tab: Tab) => {
    if (tab === activeTab) return;
    requestDraftAction(`go to ${TABS.find((item) => item.id === tab)?.label ?? "this stage"}`, () => {
      setActiveTab(tab);
    });
  };

  const latestResults = useMemo(() => {
    return results.slice(-5).reverse();
  }, [results]);

  // Pre-attentive shape + color render function for status badges
  const renderStatusBadge = (status: EmailStatus) => {
    switch (status) {
      case "valid":
        return (
          <span className="inline-flex items-center gap-1.5 rounded bg-emerald-500/10 px-2 py-0.5 text-[11px] font-bold text-emerald-400 border border-emerald-500/20">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 shrink-0" />
            VALID
          </span>
        );
      case "flagged":
        return (
          <span className="inline-flex items-center gap-1.5 rounded bg-amber-500/10 px-2 py-0.5 text-[11px] font-bold text-amber-400 border border-amber-500/20">
            <span className="w-0 h-0 border-l-[4px] border-l-transparent border-r-[4px] border-r-transparent border-b-[7px] border-b-amber-400 shrink-0" />
            FLAGGED
          </span>
        );
      case "invalid":
        return (
          <span className="inline-flex items-center gap-1.5 rounded bg-red-500/10 px-2 py-0.5 text-[11px] font-bold text-red-400 border border-red-500/20">
            <span className="w-1.5 h-1.5 bg-red-400 shrink-0" style={{ transform: "rotate(45deg)" }} />
            INVALID
          </span>
        );
    }
  };

  return (
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
                const active = activeTab === tab.id;
                const enabled = tabEnabled(tab.id);
                const complete = stageComplete[tab.id];

                return (
                  <button
                    key={tab.id}
                    disabled={!enabled}
                    onClick={() => requestTabChange(tab.id)}
                    className="relative z-10 flex flex-col items-center group cursor-pointer disabled:cursor-not-allowed focus:outline-none"
                  >
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
                  </button>
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
                  key={activeTab}
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -6 }}
                  transition={{ duration: 0.15 }}
                >

                  {/* UPLOAD STAGE */}
                  {activeTab === "upload" && (
                    <div className="space-y-lg">
                      <div className="space-y-xs">
                        <span className="text-[10px] font-bold text-primary uppercase tracking-wider">Stage 1 — Upload</span>
                        <h1 className="text-headline-lg font-bold text-on-surface tracking-tight">Data Import</h1>
                        <p className="text-body-md text-on-surface-variant">
                          Drop in a CSV of contacts — any columns, our system will auto-detect fields.
                        </p>
                      </div>

                      {/* Dropzone Widget */}
                      <div
                        onDragOver={(e) => {
                          e.preventDefault();
                          setIsDragging(true);
                        }}
                        onDragLeave={() => setIsDragging(false)}
                        onDrop={onDrop}
                        onClick={() => fileInputRef.current?.click()}
                        className={cn(
                          "flex min-h-[260px] cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed p-lg text-center transition-all",
                          isDragging
                            ? "border-primary bg-primary/5"
                            : "border-outline bg-surface hover:border-primary/55 hover:shadow-sm"
                        )}
                      >
                        <input
                          ref={fileInputRef}
                          type="file"
                          accept=".csv"
                          className="hidden"
                          onChange={(e) => {
                            const file = e.target.files?.[0];
                            if (file) handleFile(file);
                          }}
                        />
                        <div className="mb-md flex h-14 w-14 items-center justify-center rounded-xl bg-primary text-on-primary shadow-md shadow-primary/20">
                          <Icon name="cloud_upload" className="text-[28px]" />
                        </div>
                        <p className="text-headline-md font-bold text-on-surface">Drag &amp; drop your CSV here</p>
                        <p className="mt-xs text-body-sm text-on-surface-variant">
                          or <span className="font-bold text-primary underline underline-offset-4">browse files</span> from your computer
                        </p>

                        <div className="mt-md rounded bg-surface-container px-3 py-1 text-[10px] font-mono tracking-wide text-on-surface-variant">
                          CSV only • Automatic field parsing
                        </div>

                        {fileName && (
                          <div className="mt-lg flex items-center gap-xs rounded-full bg-primary/10 border border-primary/20 px-4 py-1 text-label-md font-bold text-primary shadow-sm animate-pulse">
                            <Icon name="check_circle" className="text-[16px]" />
                            Loaded {fileName} — {emails.length} contact(s) ready
                          </div>
                        )}
                      </div>

                      {/* Quick Single-Email Check */}
                      <div className="rounded-2xl border border-outline bg-surface p-lg shadow-sm">
                        <span className="text-[11px] font-bold uppercase tracking-wider text-primary">
                          Quick Single-Email Check
                        </span>
                        <p className="mt-xs mb-md text-body-sm text-on-surface-variant">
                          Runs one address through the full pipeline without uploading a CSV file.
                        </p>
                        <div className="flex flex-col gap-sm sm:flex-row">
                          <input
                            value={singleEmail}
                            onChange={(e) => setSingleEmail(e.target.value)}
                            onKeyDown={(e) => e.key === "Enter" && !isCheckingSingle && checkSingleEmail()}
                            placeholder="e.g. hello@acmerobotics.io"
                            className="flex-1 rounded-lg border border-outline bg-surface-container-low px-md py-sm text-body-sm text-on-surface outline-none focus:border-primary focus:ring-1 focus:ring-primary/20"
                          />
                          <button
                            onClick={checkSingleEmail}
                            disabled={isCheckingSingle || !singleEmail.trim()}
                            className="flex items-center justify-center gap-sm rounded-lg bg-primary px-lg py-sm text-label-md font-extrabold text-on-primary transition-opacity hover:opacity-95 disabled:opacity-50 cursor-pointer shrink-0"
                          >
                            <Icon name={isCheckingSingle ? "sync" : "bolt"} className={isCheckingSingle ? "animate-spin text-[18px]" : "text-[18px]"} />
                            {isCheckingSingle ? "Checking…" : "Run Pipeline"}
                          </button>
                        </div>
                        {singleResult && (
                          <div className="mt-md flex items-center gap-sm rounded-lg border border-outline bg-surface-container px-md py-sm">
                            {renderStatusBadge(singleResult.status)}
                            <span className="font-mono text-body-sm text-on-surface font-semibold">{singleResult.email}</span>
                            <span className="text-body-sm text-on-surface-variant">— {singleResult.reason}</span>
                          </div>
                        )}
                      </div>

                      {/* Stat Cards Row */}
                      <div className="grid grid-cols-1 gap-md sm:grid-cols-3">
                        {/* Total Rows Card */}
                        <div className="rounded-xl border border-outline bg-surface p-md flex items-start gap-md shadow-sm">
                          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-surface-container text-on-surface-variant">
                            <Icon name="list_alt" className="text-[20px]" />
                          </div>
                          <div>
                            <span className="text-[11px] font-bold text-on-surface-variant uppercase tracking-wider">Total Contacts</span>
                            <p className="font-mono text-headline-lg leading-tight mt-xs font-bold text-on-surface">
                              {parseInfo ? parseInfo.totalRows : "0"}
                            </p>
                            <span className="text-[10px] text-on-surface-variant font-mono">
                              {parseInfo ? "Successfully parsed" : "No file uploaded"}
                            </span>
                          </div>
                        </div>

                        {/* Skipped Missing */}
                        <div className="rounded-xl border border-outline bg-surface p-md flex items-start gap-md shadow-sm">
                          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-red-950/15 text-red-400">
                            <Icon name="remove_circle_outline" className="text-[20px]" />
                          </div>
                          <div>
                            <span className="text-[11px] font-bold text-on-surface-variant uppercase tracking-wider">Skipped (No Email)</span>
                            <p className="font-mono text-headline-lg leading-tight mt-xs font-bold text-red-400">
                              {parseInfo ? parseInfo.skippedMissingEmail : "--"}
                            </p>
                            <span className="text-[10px] text-on-surface-variant font-mono">
                              {parseInfo ? "Skipped during import" : "Will compute post-import"}
                            </span>
                          </div>
                        </div>

                        {/* Skipped Duplicates */}
                        <div className="rounded-xl border border-outline bg-surface p-md flex items-start gap-md shadow-sm">
                          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                            <Icon name="content_copy" className="text-[20px]" />
                          </div>
                          <div>
                            <span className="text-[11px] font-bold text-on-surface-variant uppercase tracking-wider">Skipped (Duplicates)</span>
                            <p className="font-mono text-headline-lg leading-tight mt-xs font-bold text-primary">
                              {parseInfo ? parseInfo.skippedDuplicate : "--"}
                            </p>
                            <span className="text-[10px] text-on-surface-variant font-mono">
                              {parseInfo ? "Deduplicated" : "Will compute post-import"}
                            </span>
                          </div>
                        </div>
                      </div>

                    </div>
                  )}

                  {/* VALIDATE STAGE */}
                  {activeTab === "validate" && (
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
                                  {renderStatusBadge(r.status)}
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
                  )}

                  {/* RESULTS STAGE */}
                  {activeTab === "results" && (
                    <div className="space-y-lg">
                      <div className="space-y-xs">
                        <span className="text-[10px] font-bold text-primary uppercase tracking-wider">Stage 3 — Results</span>
                        <h1 className="text-headline-lg font-bold text-on-surface tracking-tight">Validation Results</h1>
                        <p className="text-body-md text-on-surface-variant">
                          Filter, search, override, or download the parsed outcomes from the clean pipeline.
                        </p>
                      </div>

                      {summary.valid > 0 && (
                        <div className="flex flex-col sm:flex-row items-center justify-between gap-md rounded-xl border border-primary/30 bg-primary/5 p-md shadow-sm">
                          <div className="flex items-start gap-sm">
                            <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary animate-pulse">
                              <Icon name="auto_awesome" className="text-[18px]" />
                            </div>
                            <div>
                              <span className="font-bold block text-body-sm text-on-surface">Outreach Ready</span>
                              <span className="text-xs text-on-surface-variant">
                                Found {summary.valid} valid recipient{summary.valid === 1 ? "" : "s"}. Proceed to generate AI-drafted outreach copies.
                              </span>
                            </div>
                          </div>
                          <button
                            onClick={() => setActiveTab("draft")}
                            className="flex items-center gap-xs rounded-lg bg-primary px-md py-sm text-label-md font-extrabold text-on-primary transition-all hover:scale-[1.02] active:scale-95 cursor-pointer shadow-md shadow-primary/20 whitespace-nowrap"
                          >
                            Proceed to Drafts
                            <Icon name="arrow_forward" className="text-[16px] font-extrabold" />
                          </button>
                        </div>
                      )}

                      {/* Summary statistics row */}
                      <div className="grid grid-cols-2 gap-md lg:grid-cols-4">
                        {(["total", "valid", "invalid", "flagged"] as const).map((key) => (
                          <div key={key} className="rounded-xl border border-outline bg-surface p-md shadow-sm flex flex-col justify-between min-h-[90px]">
                            <span className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wider capitalize">{key}</span>
                            <p
                              className={cn(
                                "text-headline-lg font-mono font-bold leading-none mt-xs",
                                key === "valid" && "text-primary shadow-[0_0_10px_rgba(163,230,53,0.15)]",
                                key === "invalid" && "text-red-400",
                                key === "flagged" && "text-amber-400",
                                key === "total" && "text-on-surface"
                              )}
                            >
                              {summary[key]}
                            </p>
                          </div>
                        ))}
                      </div>

                      {/* Controls: tabs, search, csv download */}
                      <div className="flex flex-wrap items-center justify-between gap-md">
                        {/* Custom filter tabs containing shape icon indicators */}
                        <div className="flex items-center gap-xs">
                          <button
                            onClick={() => setFilter("all")}
                            className={cn(
                              "rounded-lg px-md py-sm text-xs font-bold uppercase transition-all border cursor-pointer",
                              filter === "all"
                                ? "border-primary bg-primary/10 text-primary"
                                : "border-outline bg-surface text-on-surface-variant hover:border-primary hover:text-on-surface"
                            )}
                          >
                            All ({summary.total})
                          </button>
                          <button
                            onClick={() => setFilter("valid")}
                            className={cn(
                              "rounded-lg px-md py-sm text-xs font-bold uppercase transition-all border cursor-pointer flex items-center gap-1.5",
                              filter === "valid"
                                ? "border-primary bg-primary/10 text-primary"
                                : "border-outline bg-surface text-on-surface-variant hover:border-primary hover:text-on-surface"
                            )}
                          >
                            <span className="w-1.5 h-1.5 rounded-full bg-primary" />
                            Valid ({summary.valid})
                          </button>
                          <button
                            onClick={() => setFilter("flagged")}
                            className={cn(
                              "rounded-lg px-md py-sm text-xs font-bold uppercase transition-all border cursor-pointer flex items-center gap-1.5",
                              filter === "flagged"
                                ? "border-amber-400 bg-amber-400/10 text-amber-400"
                                : "border-outline bg-surface text-on-surface-variant hover:border-primary hover:text-on-surface"
                            )}
                          >
                            <span className="w-0 h-0 border-l-[3px] border-l-transparent border-r-[3px] border-r-transparent border-b-[6px] border-b-amber-400" />
                            Flagged ({summary.flagged})
                          </button>
                          <button
                            onClick={() => setFilter("invalid")}
                            className={cn(
                              "rounded-lg px-md py-sm text-xs font-bold uppercase transition-all border cursor-pointer flex items-center gap-1.5",
                              filter === "invalid"
                                ? "border-red-400 bg-red-400/10 text-red-400"
                                : "border-outline bg-surface text-on-surface-variant hover:border-primary hover:text-on-surface"
                            )}
                          >
                            <span className="w-1.5 h-1.5 bg-red-400 rotate-45" />
                            Invalid ({summary.invalid})
                          </button>
                        </div>

                        <div className="flex items-center gap-sm">
                          <div className="relative">
                            <Icon
                              name="search"
                              className="pointer-events-none absolute left-sm top-1/2 -translate-y-1/2 text-[16px] text-on-surface-variant"
                            />
                            <input
                              value={resultsSearch}
                              onChange={(e) => setResultsSearch(e.target.value)}
                              placeholder="Search list…"
                              className="w-48 rounded-lg border border-outline bg-surface-container-low py-sm pl-8 pr-md text-xs text-on-surface outline-none transition-all focus:border-primary focus:w-60 focus:ring-1 focus:ring-primary/20"
                            />
                          </div>
                          <button
                            onClick={() => downloadCsv("email-validation-results.csv", resultsToCsv(results))}
                            className="flex items-center gap-sm rounded-lg border border-outline bg-surface px-md py-sm text-label-md font-bold text-on-surface hover:text-primary transition-colors cursor-pointer shadow-sm"
                          >
                            <Icon name="download" className="text-[18px]" />
                            CSV
                          </button>
                          {summary.flagged > 0 && (
                            <button
                              onClick={markAllFlaggedValid}
                              title="Manually mark every flagged email as valid based on your checks"
                              className="flex items-center gap-sm rounded-lg border border-amber-400/30 bg-amber-400/10 px-md py-sm text-label-md font-bold text-amber-400 hover:bg-amber-400/20 transition-colors cursor-pointer shadow-sm whitespace-nowrap"
                            >
                              <Icon name="check_circle" className="text-[18px]" />
                              Mark All Flagged Valid
                            </button>
                          )}
                          {summary.invalid > 0 && (
                            <button
                              onClick={markAllInvalidValid}
                              title="Manually mark every invalid email as valid based on your own checks — use with caution, these failed automated validation"
                              className="flex items-center gap-sm rounded-lg border border-red-400/30 bg-red-400/10 px-md py-sm text-label-md font-bold text-red-400 hover:bg-red-400/20 transition-colors cursor-pointer shadow-sm whitespace-nowrap"
                            >
                              <Icon name="check_circle" className="text-[18px]" />
                              Mark All Invalid Valid
                            </button>
                          )}
                          {validContacts.length > 0 && (
                            <button
                              onClick={() => setActiveTab("draft")}
                              className="flex items-center gap-sm rounded-lg bg-primary px-md py-sm text-label-md font-extrabold text-on-primary transition-all hover:scale-[1.02] active:scale-95 cursor-pointer shadow-md shadow-primary/20 whitespace-nowrap"
                            >
                              <Icon name="auto_awesome" className="text-[18px]" />
                              Proceed to Drafts
                            </button>
                          )}
                        </div>
                      </div>

                      {/* Results Data Table */}
                      <div className="overflow-hidden rounded-xl border border-outline bg-surface shadow-md">
                        <div className="max-h-[420px] overflow-auto">
                          <table className="w-full min-w-[1100px] border-collapse text-left text-body-sm table-fixed">
                            <thead className="sticky top-0 bg-surface-container border-b border-outline select-none z-10">
                              <tr>
                                <th className="w-[130px] px-md py-md text-[10px] font-bold uppercase tracking-wider text-on-surface-variant">Brand</th>
                                <th className="w-[110px] px-md py-md text-[10px] font-bold uppercase tracking-wider text-on-surface-variant">Category</th>
                                <th className="w-[130px] px-md py-md text-[10px] font-bold uppercase tracking-wider text-on-surface-variant">POC Name</th>
                                <th className="w-[130px] px-md py-md text-[10px] font-bold uppercase tracking-wider text-on-surface-variant">Designation</th>
                                <th className="w-[80px] px-md py-md text-center text-[10px] font-bold uppercase tracking-wider text-on-surface-variant">LinkedIn</th>
                                <th className="w-[200px] px-md py-md text-[10px] font-bold uppercase tracking-wider text-on-surface-variant">Email</th>
                                <th className="w-[110px] px-md py-md text-[10px] font-bold uppercase tracking-wider text-on-surface-variant">Status</th>
                                <th className="w-[250px] px-md py-md text-[10px] font-bold uppercase tracking-wider text-on-surface-variant">Reason</th>
                                <th className="w-[110px] px-md py-md text-[10px] font-bold uppercase tracking-wider text-on-surface-variant">Override</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-outline/40">
                              {filteredResults.map((r) => (
                                <tr key={r.email} className="transition-colors hover:bg-surface-container/30">
                                  <td className="truncate px-md py-md font-semibold text-on-surface" title={r.brand}>{r.brand}</td>
                                  <td className="truncate px-md py-md text-on-surface-variant/90" title={r.category}>{r.category}</td>
                                  <td className="truncate px-md py-md text-on-surface-variant/90" title={r.pocName}>{r.pocName}</td>
                                  <td className="truncate px-md py-md text-on-surface-variant/90" title={r.pocDesignation}>{r.pocDesignation}</td>
                                  <td className="px-md py-md text-center">
                                    {r.linkedinUrl && (
                                      <a
                                        href={r.linkedinUrl}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="text-primary hover:opacity-75 inline-flex items-center"
                                      >
                                        <Icon name="link" className="text-[16px]" />
                                      </a>
                                    )}
                                  </td>
                                  <td className="truncate px-md py-md font-mono text-[11px] text-on-surface" title={r.email}>{r.email}</td>
                                  <td className="px-md py-md select-none">
                                    {renderStatusBadge(r.status)}
                                  </td>
                                  <td className="px-md py-md text-[11px] text-on-surface-variant/90 leading-relaxed break-words whitespace-normal">{r.reason}</td>
                                  <td className="px-md py-md">
                                    {r.status !== "valid" && (
                                      <button
                                        onClick={() => markResultValid(r.email)}
                                        title="Manually mark email as valid based on your checks"
                                        className="inline-flex items-center text-[10px] font-bold text-primary hover:underline cursor-pointer"
                                      >
                                        mark valid
                                      </button>
                                    )}
                                  </td>
                                </tr>
                              ))}
                              {filteredResults.length === 0 && (
                                <tr>
                                  <td colSpan={9} className="text-center py-xl text-on-surface-variant font-mono">
                                    No records found matching filters.
                                  </td>
                                </tr>
                              )}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* DRAFT STAGE */}
                  {activeTab === "draft" && (
                    <div className="space-y-lg">
                      {draftView === "editor" && selectedDraft ? (
                        <div className="mx-auto max-w-4xl space-y-md">
                          <div className="flex flex-col gap-md rounded-2xl border border-outline bg-surface p-md shadow-sm sm:flex-row sm:items-center sm:justify-between">
                            <div className="flex min-w-0 items-center gap-sm">
                              <button
                                onClick={() => requestDraftAction("return to generation settings", () => setDraftView("setup"))}
                                className="flex shrink-0 items-center gap-xs rounded-lg border border-outline bg-surface-container-low px-sm py-sm text-label-md font-bold text-on-surface-variant transition-colors hover:border-primary hover:text-primary focus:outline-none focus:ring-2 focus:ring-primary/30"
                              >
                                <Icon name="arrow_back" className="text-[18px]" />
                                <span className="hidden sm:inline">Generation settings</span>
                              </button>
                              <div className="min-w-0">
                                <p className="text-[10px] font-bold uppercase tracking-wider text-primary">Draft review</p>
                                <p className="truncate text-body-sm font-semibold text-on-surface">
                                  {selectedDraft.pocName || "Recipient"}{selectedDraft.brand ? ` — ${selectedDraft.brand}` : ""}
                                </p>
                              </div>
                            </div>
                            <div className="flex items-center justify-between gap-sm sm:justify-end">
                              <span className="rounded-full border border-outline bg-surface-container-low px-sm py-xs font-mono text-[11px] font-bold text-on-surface-variant">
                                Draft {selectedDraftIndex + 1} of {drafts.length}
                              </span>
                              <div className="flex items-center gap-xs">
                                <button
                                  aria-label="Previous draft"
                                  title="Previous draft"
                                  disabled={selectedDraftIndex <= 0}
                                  onClick={() => {
                                    const previous = drafts[selectedDraftIndex - 1];
                                    if (previous) requestDraftAction("review the previous draft", () => openDraftEditor(previous.email));
                                  }}
                                  className="flex h-9 w-9 items-center justify-center rounded-lg border border-outline bg-surface-container-low text-on-surface-variant transition-colors hover:border-primary hover:text-primary disabled:cursor-not-allowed disabled:opacity-40 focus:outline-none focus:ring-2 focus:ring-primary/30"
                                >
                                  <Icon name="chevron_left" className="text-[20px]" />
                                </button>
                                <button
                                  aria-label="Next draft"
                                  title="Next draft"
                                  disabled={selectedDraftIndex >= drafts.length - 1}
                                  onClick={() => {
                                    const next = drafts[selectedDraftIndex + 1];
                                    if (next) requestDraftAction("review the next draft", () => openDraftEditor(next.email));
                                  }}
                                  className="flex h-9 w-9 items-center justify-center rounded-lg border border-outline bg-surface-container-low text-on-surface-variant transition-colors hover:border-primary hover:text-primary disabled:cursor-not-allowed disabled:opacity-40 focus:outline-none focus:ring-2 focus:ring-primary/30"
                                >
                                  <Icon name="chevron_right" className="text-[20px]" />
                                </button>
                              </div>
                            </div>
                          </div>

                          {isSending && (
                            <div className="flex items-start gap-sm rounded-xl border border-amber-500/25 bg-amber-500/10 px-md py-sm text-body-sm text-amber-200">
                              <Icon name="lock" className="mt-0.5 text-[18px] text-amber-400" />
                              <span>Editing is locked while the current outreach run is sending.</span>
                            </div>
                          )}

                          <section className="overflow-hidden rounded-2xl border border-outline bg-surface shadow-lg">
                            <div className="border-b border-outline bg-surface-container-low px-md py-sm">
                              <p className="text-[10px] font-bold uppercase tracking-wider text-on-surface-variant">Compose email</p>
                            </div>
                            <div className="space-y-md p-md sm:p-lg">
                              <div className="grid gap-sm rounded-xl border border-outline bg-surface-container-low p-md sm:grid-cols-[72px_minmax(0,1fr)] sm:items-center">
                                <span className="text-[10px] font-bold uppercase tracking-wider text-on-surface-variant">To</span>
                                <div className="min-w-0">
                                  <p className="truncate text-body-sm font-semibold text-on-surface">{selectedDraft.email}</p>
                                  {(selectedDraft.pocName || selectedDraft.brand) && (
                                    <p className="truncate text-xs text-on-surface-variant">
                                      {[selectedDraft.pocName, selectedDraft.brand].filter(Boolean).join(" · ")}
                                    </p>
                                  )}
                                </div>
                              </div>

                              <div className="space-y-1.5">
                                <label htmlFor="draft-subject" className="text-[10px] font-bold uppercase tracking-wider text-on-surface-variant">Subject</label>
                                <input
                                  id="draft-subject"
                                  value={editorSubject}
                                  disabled={isSending}
                                  onChange={(event) => {
                                    setEditorSubject(event.target.value);
                                    setEditorError(null);
                                    setEditorSaved(false);
                                  }}
                                  className="w-full rounded-xl border border-outline bg-surface-container-low px-md py-md text-body-md font-semibold text-on-surface outline-none transition-colors placeholder:text-on-surface-variant/60 focus:border-primary focus:ring-2 focus:ring-primary/20 disabled:cursor-not-allowed disabled:opacity-60"
                                />
                              </div>

                              <div className="space-y-1.5">
                                <div className="flex items-center justify-between gap-sm">
                                  <label htmlFor="draft-body" className="text-[10px] font-bold uppercase tracking-wider text-on-surface-variant">Message</label>
                                  <span className="text-[11px] text-on-surface-variant">Plain text email</span>
                                </div>
                                <textarea
                                  id="draft-body"
                                  value={editorBody}
                                  disabled={isSending}
                                  onChange={(event) => {
                                    setEditorBody(event.target.value);
                                    setEditorError(null);
                                    setEditorSaved(false);
                                  }}
                                  rows={18}
                                  className="min-h-[360px] w-full resize-y rounded-xl border border-outline bg-surface-container-low px-md py-md font-sans text-body-md leading-relaxed text-on-surface outline-none transition-colors placeholder:text-on-surface-variant/60 focus:border-primary focus:ring-2 focus:ring-primary/20 disabled:cursor-not-allowed disabled:opacity-60"
                                />
                                <p className="text-[11px] text-on-surface-variant">The signature below is appended automatically and isn&apos;t part of this text — edit it in Generation settings.</p>
                              </div>

                              <div className="space-y-1.5">
                                <label className="text-[10px] font-bold uppercase tracking-wider text-on-surface-variant">Signature preview (as sent)</label>
                                <div className="rounded-xl border border-outline bg-white p-lg">
                                  <div dangerouslySetInnerHTML={{ __html: signatureHtml }} />
                                </div>
                              </div>

                              {editorError && (
                                <p className="flex items-center gap-xs text-xs font-semibold text-red-400" role="alert">
                                  <Icon name="error" className="text-[14px]" />
                                  {editorError}
                                </p>
                              )}
                            </div>

                            <div className="sticky bottom-0 flex flex-col gap-sm border-t border-outline bg-surface/95 px-md py-md backdrop-blur sm:flex-row sm:items-center sm:justify-between">
                              <div className="min-h-5 text-xs font-semibold" aria-live="polite">
                                {editorSaved && <span className="inline-flex items-center gap-1.5 text-primary"><Icon name="check_circle" className="text-[16px]" />Saved</span>}
                                {isDraftDirty && !editorSaved && <span className="text-on-surface-variant">Unsaved changes</span>}
                              </div>
                              <div className="flex flex-wrap items-center gap-sm">
                                <button
                                  onClick={() => copyDraft(selectedDraft.email, selectedDraft.subject, selectedDraft.body)}
                                  disabled={isDraftDirty}
                                  title={isDraftDirty ? "Save changes before copying" : "Copy saved email"}
                                  className="flex items-center gap-xs rounded-lg border border-outline bg-surface-container-low px-md py-sm text-label-md font-bold text-on-surface-variant transition-colors hover:border-primary hover:text-primary disabled:cursor-not-allowed disabled:opacity-45 focus:outline-none focus:ring-2 focus:ring-primary/30"
                                >
                                  <Icon name={copiedEmail === selectedDraft.email ? "check" : "content_copy"} className="text-[16px]" />
                                  {copiedEmail === selectedDraft.email ? "Copied" : "Copy"}
                                </button>
                                <button
                                  onClick={() =>
                                    downloadTextFile(
                                      `${selectedDraft.email}.txt`,
                                      `Subject: ${selectedDraft.subject}\n\n${selectedDraft.body}`
                                    )
                                  }
                                  disabled={isDraftDirty}
                                  title={isDraftDirty ? "Save changes before downloading" : "Download this email as a text file"}
                                  className="flex items-center gap-xs rounded-lg border border-outline bg-surface-container-low px-md py-sm text-label-md font-bold text-on-surface-variant transition-colors hover:border-primary hover:text-primary disabled:cursor-not-allowed disabled:opacity-45 focus:outline-none focus:ring-2 focus:ring-primary/30"
                                >
                                  <Icon name="download" className="text-[16px]" />
                                  Download
                                </button>
                                <button
                                  onClick={discardDraftChanges}
                                  disabled={!isDraftDirty || isSending}
                                  className="flex items-center gap-xs rounded-lg border border-outline bg-surface-container-low px-md py-sm text-label-md font-bold text-on-surface-variant transition-colors hover:text-on-surface disabled:cursor-not-allowed disabled:opacity-45 focus:outline-none focus:ring-2 focus:ring-primary/30"
                                >
                                  <Icon name="undo" className="text-[16px]" />
                                  Discard changes
                                </button>
                                <button
                                  onClick={saveDraftChanges}
                                  disabled={!isDraftDirty || isSending}
                                  className="flex items-center gap-xs rounded-lg bg-primary px-md py-sm text-label-md font-extrabold text-on-primary shadow-sm transition-transform hover:scale-[1.02] active:scale-95 disabled:cursor-not-allowed disabled:opacity-45 focus:outline-none focus:ring-2 focus:ring-primary/30"
                                >
                                  <Icon name="check" className="text-[16px]" />
                                  Save changes
                                </button>
                                <button
                                  onClick={() => requestTabChange("send")}
                                  disabled={isSending || draftsStale}
                                  title={draftsStale ? "Regenerate drafts to include newly-approved contacts before sending" : "Go to the Send stage"}
                                  className="flex items-center gap-xs rounded-lg border border-primary bg-primary/10 px-md py-sm text-label-md font-extrabold text-primary transition-colors hover:bg-primary/20 disabled:cursor-not-allowed disabled:opacity-45 focus:outline-none focus:ring-2 focus:ring-primary/30"
                                >
                                  <Icon name="send" className="text-[16px]" />
                                  Ready to send
                                </button>
                              </div>
                            </div>
                          </section>
                        </div>
                      ) : (
                        <>
                          <div className="space-y-xs">
                            <span className="text-[10px] font-bold text-primary uppercase tracking-wider">Stage 4 — Draft</span>
                            <h1 className="text-headline-lg font-bold text-on-surface tracking-tight">AI Outreach Generation</h1>
                            <p className="text-body-md text-on-surface-variant">
                              Set up your outreach, then review each generated message in a focused editor before sending.
                            </p>
                          </div>

                          {drafts.length > 0 && (
                            <div className={cn(
                              "flex flex-col gap-md rounded-2xl border p-md shadow-sm sm:flex-row sm:items-center sm:justify-between",
                              draftsStale ? "border-amber-500/30 bg-amber-500/10" : "border-primary/25 bg-primary/5"
                            )}>
                              <div className="flex items-start gap-sm">
                                <div className={cn(
                                  "flex h-10 w-10 shrink-0 items-center justify-center rounded-xl shadow-sm",
                                  draftsStale ? "bg-amber-500 text-on-primary" : "bg-primary text-on-primary"
                                )}>
                                  <Icon name={draftsStale ? "sync_problem" : "mark_email_read"} className="text-[21px]" />
                                </div>
                                <div>
                                  <p className="text-body-md font-bold text-on-surface">{drafts.length} draft{drafts.length === 1 ? "" : "s"} ready to review</p>
                                  {draftsStale ? (
                                    <p className="text-body-sm text-amber-400 font-semibold">
                                      Contacts were approved after these drafts were generated. Regenerate to include them — sending is locked until you do.
                                    </p>
                                  ) : (
                                    <p className="text-body-sm text-on-surface-variant">Open the full-page editor to review, refine, and save each email.</p>
                                  )}
                                </div>
                              </div>
                              <div className="flex flex-wrap gap-sm">
                                <button
                                  onClick={() => downloadCsv("outreach-drafts.csv", draftsToCsv(drafts))}
                                  className="flex items-center gap-xs rounded-lg border border-outline bg-surface px-md py-sm text-label-md font-bold text-on-surface-variant transition-colors hover:border-primary hover:text-primary focus:outline-none focus:ring-2 focus:ring-primary/30"
                                >
                                  <Icon name="download" className="text-[18px]" />
                                  CSV
                                </button>
                                <button
                                  onClick={() => openDraftEditor(selectedDraftEmail ?? drafts[0].email)}
                                  className="flex items-center gap-xs rounded-lg bg-primary px-md py-sm text-label-md font-extrabold text-on-primary shadow-sm transition-transform hover:scale-[1.02] active:scale-95 focus:outline-none focus:ring-2 focus:ring-primary/30"
                                >
                                  Review drafts
                                  <Icon name="arrow_forward" className="text-[17px]" />
                                </button>
                                <button
                                  onClick={() => requestTabChange("send")}
                                  disabled={draftsStale}
                                  title={draftsStale ? "Regenerate drafts to include newly-approved contacts before sending" : "Go to the Send stage"}
                                  className="flex items-center gap-xs rounded-lg border border-primary bg-primary/10 px-md py-sm text-label-md font-extrabold text-primary transition-colors hover:bg-primary/20 disabled:cursor-not-allowed disabled:opacity-45 focus:outline-none focus:ring-2 focus:ring-primary/30"
                                >
                                  <Icon name="send" className="text-[16px]" />
                                  Ready to send
                                </button>
                              </div>
                            </div>
                          )}

                          <div className="rounded-2xl border border-outline bg-surface p-lg shadow-sm space-y-md">
                            <div className="flex flex-wrap items-center justify-between gap-xs border-b border-outline pb-xs">
                              <span className="text-[11px] font-bold text-primary uppercase tracking-wider">Generation settings</span>
                              <div className="flex items-center gap-md">
                                <button
                                  onClick={() => setOutreachConfig(ELEVIQUE_OUTREACH_CONFIG)}
                                  className="flex items-center gap-1 text-xs font-bold text-primary hover:underline focus:outline-none focus:ring-2 focus:ring-primary/30"
                                >
                                  <span>⚡ Reset to Elevique Template</span>
                                </button>
                                <button
                                  onClick={() => setOutreachConfig({ senderName: "", company: "", pitch: "", cta: "", signature: "", proofPoints: "", businessAddress: "", tone: "casual", title: "", mobile: "", contactEmail: "", website: "", customHook: "" })}
                                  className="cursor-pointer text-xs font-semibold text-on-surface-variant underline decoration-dotted hover:text-primary focus:outline-none focus:ring-2 focus:ring-primary/30"
                                >
                                  Clear form
                                </button>
                              </div>
                            </div>

                            <div className="grid grid-cols-1 gap-md sm:grid-cols-2">
                              <div className="flex flex-col gap-1">
                                <label className="text-[10px] font-bold uppercase tracking-wider text-on-surface-variant">Sender Name</label>
                                <input value={outreachConfig.senderName} onChange={(event) => updateConfig({ senderName: event.target.value })} placeholder="e.g. Akshita Verma" className="rounded-lg border border-outline bg-surface-container-low px-md py-sm text-body-sm text-on-surface outline-none focus:border-primary focus:ring-2 focus:ring-primary/20" />
                              </div>
                              <div className="flex flex-col gap-1">
                                <label className="text-[10px] font-bold uppercase tracking-wider text-on-surface-variant">Company Name</label>
                                <input value={outreachConfig.company} onChange={(event) => updateConfig({ company: event.target.value })} placeholder="e.g. Elevique Creations" className="rounded-lg border border-outline bg-surface-container-low px-md py-sm text-body-sm text-on-surface outline-none focus:border-primary focus:ring-2 focus:ring-primary/20" />
                              </div>
                            </div>

                            <div className="flex flex-col gap-1">
                              <label className="text-[10px] font-bold uppercase tracking-wider text-on-surface-variant">Pitch / Value Prop</label>
                              <textarea value={outreachConfig.pitch} onChange={(event) => updateConfig({ pitch: event.target.value })} placeholder="What do you offer, how are you different?" rows={3} className="rounded-lg border border-outline bg-surface-container-low px-md py-sm text-body-sm text-on-surface outline-none focus:border-primary focus:ring-2 focus:ring-primary/20" />
                            </div>

                            <div className="flex flex-col gap-1">
                              <div className="flex items-center justify-between gap-sm">
                                <label className="text-[10px] font-bold uppercase tracking-wider text-on-surface-variant">Custom Hook (Optional)</label>
                                <span className="text-[11px] text-on-surface-variant">Skips AI personalization for all recipients</span>
                              </div>
                              <textarea value={outreachConfig.customHook} onChange={(event) => updateConfig({ customHook: event.target.value })} placeholder="Leave blank to let AI write a personalized opening hook per recipient. Type your own here to use the exact same hook for everyone instead." rows={2} className="rounded-lg border border-outline bg-surface-container-low px-md py-sm text-body-sm text-on-surface outline-none focus:border-primary focus:ring-2 focus:ring-primary/20" />
                            </div>

                            <div className="flex flex-col gap-1">
                              <label className="text-[10px] font-bold uppercase tracking-wider text-on-surface-variant">Proof Points</label>
                              <textarea value={outreachConfig.proofPoints} onChange={(event) => updateConfig({ proofPoints: event.target.value })} placeholder="e.g. www.elevique.in/portfolio" rows={2} className="rounded-lg border border-outline bg-surface-container-low px-md py-sm text-body-sm text-on-surface outline-none focus:border-primary focus:ring-2 focus:ring-primary/20" />
                            </div>

                            <div className="grid grid-cols-1 gap-md sm:grid-cols-2">
                              <div className="flex flex-col gap-1">
                                <label className="text-[10px] font-bold uppercase tracking-wider text-on-surface-variant">Call to Action</label>
                                <textarea value={outreachConfig.cta} onChange={(event) => updateConfig({ cta: event.target.value })} placeholder="e.g. If you feel it's worth a 15-minute walkthrough..." rows={3} className="rounded-lg border border-outline bg-surface-container-low px-md py-sm text-body-sm text-on-surface outline-none focus:border-primary focus:ring-2 focus:ring-primary/20" />
                              </div>
                              <div className="flex flex-col gap-1">
                                <label className="text-[10px] font-bold uppercase tracking-wider text-on-surface-variant">Sign-off / Signature</label>
                                <textarea value={outreachConfig.signature} onChange={(event) => updateConfig({ signature: event.target.value })} placeholder="e.g. Thanks & Regards,&#10;Akshita Verma&#10;Elevique Creations" rows={3} className="rounded-lg border border-outline bg-surface-container-low px-md py-sm font-mono text-xs text-on-surface outline-none focus:border-primary focus:ring-2 focus:ring-primary/20" />
                              </div>
                            </div>

                            <div className="grid grid-cols-1 gap-md sm:grid-cols-2">
                              <div className="flex flex-col gap-1">
                                <label className="text-[10px] font-bold uppercase tracking-wider text-on-surface-variant">Title / Role</label>
                                <input value={outreachConfig.title} onChange={(event) => updateConfig({ title: event.target.value })} placeholder="e.g. Founder" className="rounded-lg border border-outline bg-surface-container-low px-md py-sm text-body-sm text-on-surface outline-none focus:border-primary focus:ring-2 focus:ring-primary/20" />
                              </div>
                              <div className="flex flex-col gap-1">
                                <label className="text-[10px] font-bold uppercase tracking-wider text-on-surface-variant">Mobile</label>
                                <input value={outreachConfig.mobile} onChange={(event) => updateConfig({ mobile: event.target.value })} placeholder="e.g. +91 7217832613" className="rounded-lg border border-outline bg-surface-container-low px-md py-sm text-body-sm text-on-surface outline-none focus:border-primary focus:ring-2 focus:ring-primary/20" />
                              </div>
                            </div>

                            <div className="grid grid-cols-1 gap-md sm:grid-cols-2">
                              <div className="flex flex-col gap-1">
                                <label className="text-[10px] font-bold uppercase tracking-wider text-on-surface-variant">Contact Email</label>
                                <input value={outreachConfig.contactEmail} onChange={(event) => updateConfig({ contactEmail: event.target.value })} placeholder="e.g. connect@elevique.in" className="rounded-lg border border-outline bg-surface-container-low px-md py-sm text-body-sm text-on-surface outline-none focus:border-primary focus:ring-2 focus:ring-primary/20" />
                              </div>
                              <div className="flex flex-col gap-1">
                                <label className="text-[10px] font-bold uppercase tracking-wider text-on-surface-variant">Website</label>
                                <input value={outreachConfig.website} onChange={(event) => updateConfig({ website: event.target.value })} placeholder="e.g. elevique.in" className="rounded-lg border border-outline bg-surface-container-low px-md py-sm text-body-sm text-on-surface outline-none focus:border-primary focus:ring-2 focus:ring-primary/20" />
                              </div>
                            </div>

                            <div className="flex flex-col gap-1">
                              <label className="text-[10px] font-bold uppercase tracking-wider text-on-surface-variant">Business Address (Anti-Spam Requirement)</label>
                              <input value={outreachConfig.businessAddress} onChange={(event) => updateConfig({ businessAddress: event.target.value })} placeholder="e.g. 123 Main St, New York, NY 10001" className="rounded-lg border border-outline bg-surface-container-low px-md py-sm text-body-sm text-on-surface outline-none focus:border-primary focus:ring-2 focus:ring-primary/20" />
                            </div>

                            <div className="flex flex-col gap-sm pt-2 sm:flex-row sm:items-center">
                              <span className="text-[10px] font-bold uppercase tracking-wider text-on-surface-variant">Tone Style:</span>
                              <div className="flex gap-xs">
                                {TONES.map((tone) => (
                                  <button
                                    key={tone}
                                    onClick={() => updateConfig({ tone })}
                                    className={cn("rounded-lg border px-md py-xs text-xs font-bold capitalize transition-all focus:outline-none focus:ring-2 focus:ring-primary/30", outreachConfig.tone === tone ? "border-primary bg-primary/10 text-primary" : "border-outline bg-surface-container-low text-on-surface-variant hover:border-primary")}
                                  >
                                    {tone}
                                  </button>
                                ))}
                              </div>
                            </div>

                            {draftError && (
                              <div className="flex items-start gap-sm rounded-lg border border-red-500/20 bg-red-500/10 px-md py-sm text-body-sm text-red-400">
                                <Icon name="error" className="text-[18px]" />
                                {draftError}
                              </div>
                            )}

                            <div className="border-t border-outline/50 pt-md">
                              {isDrafting ? (
                                <div className="space-y-sm">
                                  <div className="flex justify-between text-xs font-mono font-bold text-primary">
                                    <span>Generating outreach copies...</span>
                                    <span>{draftProgress.done} / {draftProgress.total}</span>
                                  </div>
                                  <div className="h-2 w-full overflow-hidden rounded-full bg-surface-container">
                                    <motion.div className="h-full bg-primary" animate={{ width: draftProgress.total ? `${(draftProgress.done / draftProgress.total) * 100}%` : "0%" }} transition={{ duration: 0.2 }} />
                                  </div>
                                </div>
                              ) : (
                                <button onClick={generateDraftsHandler} disabled={!configComplete || isSending} className="flex items-center gap-sm rounded-lg bg-primary px-lg py-md text-label-md font-extrabold text-on-primary shadow-lg shadow-primary/20 transition-opacity hover:opacity-95 disabled:cursor-not-allowed disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-primary/30">
                                  <Icon name="auto_awesome" className="text-[18px]" />
                                  {drafts.length > 0 ? "Regenerate outreach drafts" : `Generate Outreach Drafts (${validContacts.length} recipient${validContacts.length === 1 ? "" : "s"})`}
                                </button>
                              )}
                              {!configComplete && !isDrafting && <p className="mt-2 text-xs font-mono text-on-surface-variant">* All form details must be provided to run draft generation.</p>}
                              {isSending && <p className="mt-2 text-xs font-mono text-on-surface-variant">* Regeneration is disabled while a sending run is active.</p>}
                              {draftsStale && !isSending && <p className="mt-2 text-xs font-mono text-amber-400 font-semibold">* Contacts were approved after these drafts were generated — regenerate to include them before sending.</p>}
                            </div>
                          </div>
                        </>
                      )}

                      {pendingDraftAction && (
                        <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/75 p-md backdrop-blur-sm" role="presentation">
                          <div role="dialog" aria-modal="true" aria-labelledby="unsaved-draft-title" className="w-full max-w-[28rem] rounded-2xl border border-outline bg-surface p-lg shadow-2xl">
                            <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-amber-500/30 bg-amber-500/10 text-amber-400">
                              <Icon name="edit_note" className="text-[21px]" />
                            </div>
                            <h2 id="unsaved-draft-title" className="mt-md text-headline-md font-bold text-on-surface">Save your changes?</h2>
                            <p className="mt-xs text-body-sm leading-relaxed text-on-surface-variant">You have unsaved changes. Choose what to do before you {pendingDraftAction.description}.</p>
                            <div className="mt-lg flex flex-col-reverse gap-sm sm:flex-row sm:justify-end">
                              <button onClick={() => setPendingDraftAction(null)} className="rounded-lg border border-outline bg-surface-container-low px-md py-sm text-label-md font-bold text-on-surface-variant transition-colors hover:text-on-surface focus:outline-none focus:ring-2 focus:ring-primary/30">Continue editing</button>
                              <button onClick={() => resolvePendingDraftAction("discard")} className="rounded-lg border border-red-500/25 bg-red-500/10 px-md py-sm text-label-md font-bold text-red-300 transition-colors hover:bg-red-500/20 focus:outline-none focus:ring-2 focus:ring-red-400/30">Discard changes</button>
                              <button onClick={() => resolvePendingDraftAction("save")} className="rounded-lg bg-primary px-md py-sm text-label-md font-extrabold text-on-primary shadow-sm transition-transform hover:scale-[1.02] active:scale-95 focus:outline-none focus:ring-2 focus:ring-primary/30">Save &amp; continue</button>
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  {/* SEND STAGE */}
                  {activeTab === "send" && (
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

                      <div className="rounded-xl border border-outline bg-surface p-lg shadow-sm space-y-md">
                        <p className="flex items-center gap-sm text-body-sm text-on-surface-variant font-semibold">
                          <Icon name="lock" className="text-[20px] text-primary" />
                          Requires <code className="font-mono text-xs bg-surface-container px-1.5 py-0.5 rounded font-bold">EMAIL_USER</code> and{" "}
                          <code className="font-mono text-xs bg-surface-container px-1.5 py-0.5 rounded font-bold">EMAIL_PASSWORD</code> in your backend credentials.
                        </p>

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

                        {sendAutoResumeCountdown !== null && sendAutoResumeCountdown > 0 ? (
                          <div className="flex items-center gap-sm rounded-lg border border-primary/30 bg-primary/10 px-md py-sm text-body-sm text-primary font-semibold animate-pulse">
                            <Icon name="schedule" className="text-[18px]" />
                            <span>
                              Hourly send limit reached (20/20). Auto-resuming next batch in{" "}
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

                        <div className="mt-md flex gap-md">
                          <button
                            onClick={startSend}
                            disabled={isSending || drafts.length === 0 || draftsStale || (rateLimitStatus ? !rateLimitStatus.allowed : false)}
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
                  )}

                  {/* EXPORT STAGE */}
                  {activeTab === "export" && (
                    <div className="space-y-lg">
                      <div className="space-y-xs">
                        <span className="text-[10px] font-bold text-primary uppercase tracking-wider">Stage 6 — Export</span>
                        <h1 className="text-headline-lg font-bold text-on-surface tracking-tight">Data Dispatch</h1>
                        <p className="text-body-md text-on-surface-variant">
                          Export complete outputs: validation outcomes and personalized outreach copies.
                        </p>
                      </div>

                      <div className="flex flex-col items-center gap-md rounded-2xl border border-outline bg-surface p-xl text-center shadow-lg">
                        <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/10 text-primary border border-primary/20 animate-bounce">
                          <Icon name="ios_share" className="text-[32px] font-bold" />
                        </div>
                        <h3 className="text-headline-md font-bold text-on-surface">Download CSV Datasets</h3>
                        <p className="text-body-sm text-on-surface-variant max-w-[24rem]">
                          Download full validation listings or clean-only verified contacts directly to your local file system.
                        </p>
                        <div className="flex flex-col gap-md sm:flex-row mt-sm">
                          <button
                            onClick={() => downloadCsv("email-validation-results.csv", resultsToCsv(results))}
                            className="flex items-center justify-center gap-sm rounded-lg bg-primary px-lg py-md text-label-md font-extrabold text-on-primary shadow-lg shadow-primary/25 transition-all hover:scale-[1.02] active:scale-95 cursor-pointer"
                          >
                            <Icon name="download" className="text-[18px] font-bold" />
                            Download Complete Listings
                          </button>
                          <button
                            onClick={() =>
                              downloadCsv("valid-emails.csv", resultsToCsv(results.filter((r) => r.status === "valid")))
                            }
                            className="flex items-center justify-center gap-sm rounded-lg border border-outline bg-surface px-lg py-md text-label-md font-bold text-on-surface transition-colors hover:bg-surface-container cursor-pointer"
                          >
                            <Icon name="filter_alt" className="text-[18px]" />
                            Download Valid Only
                          </button>
                        </div>
                      </div>
                    </div>
                  )}

                </motion.div>
              </AnimatePresence>
            </div>
          </main>

        </div>
      </div>
    </div>
  );
}
