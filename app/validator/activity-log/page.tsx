"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Icon } from "@/components/icon";
import { listActivityLogView, ACTIVITY_LOG_POLL_MS, type ActivityLogEntryView } from "@/lib/activity-log-client";
import { cn } from "@/lib/utils";

const PAGE_SIZE = 50;

const CATEGORY_FILTERS: { label: string; value: string | null }[] = [
  { label: "All", value: null },
  { label: "Campaigns", value: "campaign" },
  { label: "Accounts", value: "account" },
  { label: "Sends", value: "send" },
  { label: "Bounces", value: "bounce" },
  { label: "Cron ticks", value: "cron" },
];

const CATEGORY_STYLES: Record<string, string> = {
  campaign: "bg-primary/10 text-primary border border-primary/20",
  account: "bg-amber-500/10 text-amber-400 border border-amber-500/20",
  send: "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20",
  bounce: "bg-red-500/10 text-red-400 border border-red-500/20",
};
const DEFAULT_CATEGORY_STYLE = "bg-on-surface-variant/10 text-on-surface-variant border border-outline";

function categoryOf(action: string): string {
  return action.split(".")[0];
}

export default function ActivityLogPage() {
  const [entries, setEntries] = useState<ActivityLogEntryView[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [category, setCategory] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);

  // Guards against a stale response (from a category switch or an overlapping
  // poll tick) landing after a newer request and clobbering fresher state.
  const requestIdRef = useRef(0);

  const loadFirstPage = useCallback((cat: string | null) => {
    const requestId = ++requestIdRef.current;
    listActivityLogView({ category: cat })
      .then((page) => {
        if (requestIdRef.current !== requestId) return;
        setEntries(page);
        setHasMore(page.length === PAGE_SIZE);
        setError(null);
      })
      .catch((err) => {
        if (requestIdRef.current !== requestId) return;
        setError(err instanceof Error ? err.message : "Failed to load activity log");
      });
  }, []);

  // Every poll re-fetches from the top (same convention as the History
  // page) — accumulated "Load more" pages are intentionally dropped on each
  // refresh rather than trying to merge new rows into an already-paged list.
  useEffect(() => {
    loadFirstPage(category);
    const interval = setInterval(() => loadFirstPage(category), ACTIVITY_LOG_POLL_MS);
    return () => clearInterval(interval);
  }, [category, loadFirstPage]);

  const loadMore = useCallback(async () => {
    if (!entries || entries.length === 0) return;
    const requestId = ++requestIdRef.current;
    setLoadingMore(true);
    try {
      const page = await listActivityLogView({ category, before: entries[entries.length - 1].id });
      if (requestIdRef.current !== requestId) return;
      setEntries([...entries, ...page]);
      setHasMore(page.length === PAGE_SIZE);
    } catch (err) {
      if (requestIdRef.current !== requestId) return;
      setError(err instanceof Error ? err.message : "Failed to load more");
    } finally {
      if (requestIdRef.current === requestId) setLoadingMore(false);
    }
  }, [entries, category]);

  return (
    <div className="space-y-lg">
      <div className="space-y-xs">
        <span className="text-[10px] font-bold text-primary uppercase tracking-wider">Activity</span>
        <h1 className="text-headline-lg font-bold text-on-surface tracking-tight">Activity Log</h1>
        <p className="text-body-md text-on-surface-variant">
          Every action taken in this app, and every background/system event that ran, in one place.
        </p>
      </div>

      <div className="flex flex-wrap gap-xs">
        {CATEGORY_FILTERS.map((f) => (
          <button
            key={f.label}
            onClick={() => setCategory(f.value)}
            className={cn(
              "rounded-lg border px-sm py-xs text-xs font-bold transition-colors cursor-pointer",
              category === f.value
                ? "border-primary/40 bg-primary/10 text-primary"
                : "border-outline bg-surface-container-low text-on-surface-variant hover:bg-surface-container"
            )}
          >
            {f.label}
          </button>
        ))}
      </div>

      {error && (
        <div className="flex items-start gap-sm rounded-xl border border-red-500/20 bg-red-500/10 px-md py-sm text-body-sm text-red-400">
          <Icon name="error" className="text-[18px]" />
          <span>{error}</span>
        </div>
      )}

      {entries === null ? (
        <p className="text-body-sm text-on-surface-variant">Loading...</p>
      ) : entries.length === 0 ? (
        <div className="flex flex-col items-center gap-md rounded-2xl border border-outline bg-surface p-xl text-center shadow-lg">
          <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/10 text-primary border border-primary/20">
            <Icon name="list_alt" className="text-[32px] font-bold" />
          </div>
          <h3 className="text-headline-md font-bold text-on-surface">No activity yet</h3>
          <p className="text-body-sm text-on-surface-variant max-w-[24rem]">
            Actions you take and background events that run will show up here.
          </p>
        </div>
      ) : (
        <>
          <div className="overflow-hidden rounded-xl border border-outline bg-surface shadow-sm">
            <div className="overflow-auto">
              <table className="w-full min-w-[640px] border-collapse text-left text-body-sm">
                <thead className="bg-surface-container border-b border-outline select-none">
                  <tr>
                    <th className="px-md py-md text-[10px] font-bold uppercase tracking-wider text-on-surface-variant">When</th>
                    <th className="px-md py-md text-[10px] font-bold uppercase tracking-wider text-on-surface-variant">Action</th>
                    <th className="px-md py-md text-[10px] font-bold uppercase tracking-wider text-on-surface-variant">Actor</th>
                    <th className="px-md py-md text-[10px] font-bold uppercase tracking-wider text-on-surface-variant">Summary</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-outline/40">
                  {entries.map((e) => (
                    <tr key={e.id} className="hover:bg-surface-container/20">
                      <td className="px-md py-md text-xs text-on-surface-variant font-mono whitespace-nowrap">
                        {new Date(e.createdAt).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })}
                      </td>
                      <td className="px-md py-md select-none">
                        <span
                          className={cn(
                            "rounded px-sm py-[2px] text-[10px] font-bold uppercase inline-block text-center",
                            CATEGORY_STYLES[categoryOf(e.action)] ?? DEFAULT_CATEGORY_STYLE
                          )}
                        >
                          {e.action}
                        </span>
                      </td>
                      <td className="px-md py-md text-xs text-on-surface-variant whitespace-nowrap">{e.actorLabel ?? e.actorType}</td>
                      <td className="px-md py-md text-xs text-on-surface">{e.summary}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          {hasMore && (
            <button
              onClick={loadMore}
              disabled={loadingMore}
              className="rounded-lg border border-outline bg-surface-container-low px-md py-sm text-xs font-bold text-on-surface transition-colors hover:bg-surface-container cursor-pointer disabled:opacity-50"
            >
              {loadingMore ? "Loading..." : "Load more"}
            </button>
          )}
        </>
      )}
    </div>
  );
}
