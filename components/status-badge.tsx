import type { EmailStatus } from "@/lib/store";

// Pre-attentive shape + color badge — shape distinguishes status even for
// colorblind users, color reinforces it. Used across Upload/Validate/Results.
export function StatusBadge({ status }: { status: EmailStatus }) {
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
}
