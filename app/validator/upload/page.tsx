"use client";

import { useCallback, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/icon";
import { StatusBadge } from "@/components/status-badge";
import { validateEmails } from "@/lib/groq-validator";
import { useValidatorStore, type EmailResult } from "@/lib/store";
import { cn, parseEmailCsv } from "@/lib/utils";

export default function UploadPage() {
  const router = useRouter();
  const { emails, uploadFileName, uploadParseInfo, setEmails, setUploadInfo, setError } = useValidatorStore();

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [singleEmail, setSingleEmail] = useState("");
  const [singleResult, setSingleResult] = useState<EmailResult | null>(null);
  const [isCheckingSingle, setIsCheckingSingle] = useState(false);

  const handleFile = useCallback(
    async (file: File) => {
      setError(null);
      try {
        const parsed = await parseEmailCsv(file);
        if (parsed.rows.length === 0) {
          setError("No email addresses found in that CSV.");
          return;
        }
        setUploadInfo(file.name, parsed);
        setEmails(parsed.rows);
        router.push("/validator/validate");
      } catch {
        setError("Couldn't parse that CSV file.");
      }
    },
    [setEmails, setUploadInfo, setError, router]
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

  return (
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

        {uploadFileName && (
          <div className="mt-lg flex items-center gap-xs rounded-full bg-primary/10 border border-primary/20 px-4 py-1 text-label-md font-bold text-primary shadow-sm animate-pulse">
            <Icon name="check_circle" className="text-[16px]" />
            Loaded {uploadFileName} — {emails.length} contact(s) ready
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
            <StatusBadge status={singleResult.status} />
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
              {uploadParseInfo ? uploadParseInfo.totalRows : "0"}
            </p>
            <span className="text-[10px] text-on-surface-variant font-mono">
              {uploadParseInfo ? "Successfully parsed" : "No file uploaded"}
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
              {uploadParseInfo ? uploadParseInfo.skippedMissingEmail : "--"}
            </p>
            <span className="text-[10px] text-on-surface-variant font-mono">
              {uploadParseInfo ? "Skipped during import" : "Will compute post-import"}
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
              {uploadParseInfo ? uploadParseInfo.skippedDuplicate : "--"}
            </p>
            <span className="text-[10px] text-on-surface-variant font-mono">
              {uploadParseInfo ? "Deduplicated" : "Will compute post-import"}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
