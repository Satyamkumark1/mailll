"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { Icon } from "@/components/icon";
import { useValidatorChrome } from "../layout";
import { generateDrafts } from "@/lib/draft-generator";
import { buildSignatureHtml } from "@/lib/email-signature";
import { ELEVIQUE_OUTREACH_CONFIG, useValidatorStore, type OutreachConfig, type Tone } from "@/lib/store";
import { cn, computeDraftsStale, downloadCsv, downloadTextFile, draftsToCsv, draftsToText } from "@/lib/utils";

const TONES: Tone[] = ["casual", "formal", "in-between"];

type PendingDraftAction = {
  description: string;
  run: () => void;
};

export default function DraftPage() {
  const router = useRouter();
  const { confirmAction, setGuardedAction } = useValidatorChrome();
  const {
    results, drafts, isDrafting, draftProgress, draftError, outreachConfig, isSending,
    setOutreachConfig, setDrafting, setDraftProgress, appendDrafts, setDraftError, clearDrafts, updateDraft,
  } = useValidatorStore();

  const [draftView, setDraftView] = useState<"setup" | "editor">("setup");
  const [selectedDraftEmail, setSelectedDraftEmail] = useState<string | null>(null);
  const [editorSubject, setEditorSubject] = useState("");
  const [editorBody, setEditorBody] = useState("");
  const [editorError, setEditorError] = useState<string | null>(null);
  const [editorSaved, setEditorSaved] = useState(false);
  const [pendingDraftAction, setPendingDraftAction] = useState<PendingDraftAction | null>(null);
  const [copiedEmail, setCopiedEmail] = useState<string | null>(null);
  const [copiedAllDrafts, setCopiedAllDrafts] = useState(false);
  const saveStatusTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const validContacts = useMemo(() => results.filter((r) => r.status === "valid"), [results]);
  const draftsStale = useMemo(() => computeDraftsStale(validContacts, drafts), [validContacts, drafts]);
  const selectedDraft = useMemo(
    () => drafts.find((draft) => draft.email === selectedDraftEmail) ?? null,
    [drafts, selectedDraftEmail]
  );
  const selectedDraftIndex = selectedDraft ? drafts.findIndex((draft) => draft.email === selectedDraft.email) : -1;
  const signatureHtml = useMemo(() => buildSignatureHtml(outreachConfig, "/elevique-logo.png"), [outreachConfig]);
  const isDraftDirty = Boolean(
    selectedDraft && (editorSubject !== selectedDraft.subject || editorBody !== selectedDraft.body)
  );

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

  // Registers with the shared layout so the tab bar / Start Over button
  // route leaving this page through the same save/discard/cancel prompt as
  // in-page navigation (Next's documented Link onNavigate + context pattern
  // for blocking navigation — see node_modules/next/dist/docs/01-app/03-api-reference/02-components/link.md).
  useEffect(() => {
    setGuardedAction(() => requestDraftAction);
    return () => setGuardedAction(null);
  }, [setGuardedAction, requestDraftAction]);

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

  const generateDraftsHandler = useCallback(async () => {
    if (drafts.length > 0) {
      const confirmed = await confirmAction(
        "Generating a new draft set will replace all current drafts, including any manual edits. Continue?",
        { title: "Replace existing drafts?", confirmLabel: "Replace drafts", tone: "warning" }
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
  }, [drafts, validContacts, outreachConfig, setDraftError, clearDrafts, setDrafting, setDraftProgress, appendDrafts, confirmAction]);

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

  const copyAllDrafts = useCallback(() => {
    navigator.clipboard.writeText(draftsToText(drafts)).then(
      () => {
        setCopiedAllDrafts(true);
        setTimeout(() => setCopiedAllDrafts(false), 2000);
      },
      () => setDraftError("Couldn't copy to clipboard — your browser may be blocking clipboard access.")
    );
  }, [drafts, setDraftError]);

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

  const goToSend = () => requestDraftAction("go to Send", () => router.push("/validator/send"));

  return (
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
                  onClick={() => downloadTextFile(`${selectedDraft.email}.txt`, `Subject: ${selectedDraft.subject}\n\n${selectedDraft.body}`)}
                  disabled={isDraftDirty}
                  title={isDraftDirty ? "Save changes before downloading" : "Download this email as a text file"}
                  className="flex items-center gap-xs rounded-lg border border-outline bg-surface-container-low px-md py-sm text-label-md font-bold text-on-surface-variant transition-colors hover:border-primary hover:text-primary disabled:cursor-not-allowed disabled:opacity-45 focus:outline-none focus:ring-2 focus:ring-primary/30"
                >
                  <Icon name="download" className="text-[16px]" />
                  Download
                </button>
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
                  onClick={() => downloadTextFile("outreach-drafts.txt", draftsToText(drafts))}
                  title={`Download all ${drafts.length} draft${drafts.length === 1 ? "" : "s"} as a single text file`}
                  className="flex items-center gap-xs rounded-lg border border-primary bg-primary/10 px-md py-sm text-label-md font-extrabold text-primary transition-colors hover:bg-primary/20 focus:outline-none focus:ring-2 focus:ring-primary/30"
                >
                  <Icon name="download_for_offline" className="text-[16px]" />
                  Download All ({drafts.length})
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
                  onClick={goToSend}
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
                  onClick={() => downloadTextFile("outreach-drafts.txt", draftsToText(drafts))}
                  title="Download all drafts as a single readable text file"
                  className="flex items-center gap-xs rounded-lg border border-outline bg-surface px-md py-sm text-label-md font-bold text-on-surface-variant transition-colors hover:border-primary hover:text-primary focus:outline-none focus:ring-2 focus:ring-primary/30"
                >
                  <Icon name="download" className="text-[18px]" />
                  TXT
                </button>
                <button
                  onClick={copyAllDrafts}
                  title="Copy all drafts to the clipboard as text"
                  className="flex items-center gap-xs rounded-lg border border-outline bg-surface px-md py-sm text-label-md font-bold text-on-surface-variant transition-colors hover:border-primary hover:text-primary focus:outline-none focus:ring-2 focus:ring-primary/30"
                >
                  <Icon name={copiedAllDrafts ? "check" : "content_copy"} className="text-[18px]" />
                  {copiedAllDrafts ? "Copied" : "Copy All"}
                </button>
                <button
                  onClick={() => openDraftEditor(selectedDraftEmail ?? drafts[0].email)}
                  className="flex items-center gap-xs rounded-lg bg-primary px-md py-sm text-label-md font-extrabold text-on-primary shadow-sm transition-transform hover:scale-[1.02] active:scale-95 focus:outline-none focus:ring-2 focus:ring-primary/30"
                >
                  Review drafts
                  <Icon name="arrow_forward" className="text-[17px]" />
                </button>
                <button
                  onClick={goToSend}
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
  );
}
