import type { Tab } from "./store";

export const TABS: { id: Tab; label: string; icon: string; description: string }[] = [
  {
    id: "upload",
    label: "Upload",
    icon: "cloud_upload",
    description: "Drop in a CSV of contacts — any columns, we auto-detect the email field.",
  },
  {
    id: "validate",
    label: "Validate",
    icon: "verified_user",
    description:
      "Local heuristics catch the obvious junk instantly, then live MX + SMTP + catch-all checks, then a Groq AI pass on anything still ambiguous.",
  },
  {
    id: "results",
    label: "Results",
    icon: "bar_chart",
    description: "Filter by status, search by brand or name, and manually override any verdict.",
  },
  {
    id: "draft",
    label: "Draft",
    icon: "edit_note",
    description: "Groq writes a personalized subject + body per valid contact from your pitch and tone.",
  },
  {
    id: "send",
    label: "Send",
    icon: "send",
    description: "Schedule a background campaign — sends continue server-side even if you close the tab.",
  },
  {
    id: "export",
    label: "Export",
    icon: "ios_share",
    description: "Download the full results, valid-only list, or generated drafts as CSV.",
  },
  {
    id: "history",
    label: "History",
    icon: "history",
    description: "Browse past and running background campaigns, their progress, and any failures.",
  },
];
