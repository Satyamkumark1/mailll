"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/icon";
import { StatusBadge } from "@/components/status-badge";
import { useValidatorStore, type EmailStatus } from "@/lib/store";
import { cn, downloadCsv, resultsToCsv } from "@/lib/utils";

export default function ResultsPage() {
  const router = useRouter();
  const { results, markResultValid, markAllFlaggedValid, markAllInvalidValid } = useValidatorStore();

  const [filter, setFilter] = useState<EmailStatus | "all">("all");
  const [resultsSearch, setResultsSearch] = useState("");

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

  return (
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
            onClick={() => router.push("/validator/draft")}
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
              onClick={() => router.push("/validator/draft")}
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
                    <StatusBadge status={r.status} />
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
  );
}
