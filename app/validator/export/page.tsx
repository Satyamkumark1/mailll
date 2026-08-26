"use client";

import { Icon } from "@/components/icon";
import { useValidatorStore } from "@/lib/store";
import { downloadCsv, downloadTextFile, draftsToCsv, draftsToText, resultsToCsv } from "@/lib/utils";

export default function ExportPage() {
  const { results, drafts } = useValidatorStore();

  return (
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

      {drafts.length > 0 && (
        <div className="flex flex-col items-center gap-md rounded-2xl border border-outline bg-surface p-xl text-center shadow-lg">
          <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/10 text-primary border border-primary/20">
            <Icon name="mark_email_read" className="text-[32px] font-bold" />
          </div>
          <h3 className="text-headline-md font-bold text-on-surface">Download Draft Emails</h3>
          <p className="text-body-sm text-on-surface-variant max-w-[24rem]">
            Download all {drafts.length} generated outreach draft{drafts.length === 1 ? "" : "s"} in one click, as a spreadsheet or a single readable text file.
          </p>
          <div className="flex flex-col gap-md sm:flex-row mt-sm">
            <button
              onClick={() => downloadCsv("outreach-drafts.csv", draftsToCsv(drafts))}
              className="flex items-center justify-center gap-sm rounded-lg bg-primary px-lg py-md text-label-md font-extrabold text-on-primary shadow-lg shadow-primary/25 transition-all hover:scale-[1.02] active:scale-95 cursor-pointer"
            >
              <Icon name="download" className="text-[18px] font-bold" />
              Download All (CSV)
            </button>
            <button
              onClick={() => downloadTextFile("outreach-drafts.txt", draftsToText(drafts))}
              className="flex items-center justify-center gap-sm rounded-lg border border-outline bg-surface px-lg py-md text-label-md font-bold text-on-surface transition-colors hover:bg-surface-container cursor-pointer"
            >
              <Icon name="description" className="text-[18px]" />
              Download All (TXT)
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
