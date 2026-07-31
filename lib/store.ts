import { create } from "zustand";

export type EmailStatus = "valid" | "invalid" | "flagged";

export interface EmailRow {
  email: string;
  brand: string;
  category: string;
  linkedinUrl: string;
  pocName: string;
  pocDesignation: string;
}

export interface EmailResult extends EmailRow {
  status: EmailStatus;
  reason: string;
}

export interface DraftResult {
  email: string;
  pocName: string;
  brand: string;
  subject: string;
  body: string;
}

export type Tone = "casual" | "formal" | "in-between";

export interface OutreachConfig {
  senderName: string;
  company: string;
  pitch: string;
  cta: string;
  signature: string;
  proofPoints: string;
  businessAddress: string;
  tone: Tone;
}

export const ELEVIQUE_OUTREACH_CONFIG: OutreachConfig = {
  senderName: "Akshita Verma",
  company: "Elevique Creations",
  pitch: "Elevique produces brand films and social content for companies like yours, using AI-native production. And because we think like marketers, not just filmmakers, the work is built to perform, not just to look good.",
  proofPoints: "www.elevique.in/portfolio",
  cta: "If you feel it's worth a 15-minute walkthrough, please confirm your availability for a Google Meet or phone call this week. Alternatively, if someone on your team handles content and ads marketing, happy to take it up with them – just point me their way.",
  signature: "Thanks & Regards,\nAkshita Verma\nElevique Creations\nPh: +91-7217832613",
  businessAddress: "Elevique Creations, India",
  tone: "casual",
};

export const EMPTY_OUTREACH_CONFIG: OutreachConfig = ELEVIQUE_OUTREACH_CONFIG;

export type SendStatus = "sent" | "failed";

export interface SendResult {
  email: string;
  status: SendStatus;
  error?: string;
}

export type Tab = "upload" | "validate" | "results" | "draft" | "send" | "export";

interface ValidatorState {
  activeTab: Tab;
  emails: EmailRow[];
  results: EmailResult[];
  isValidating: boolean;
  progress: { done: number; total: number };
  error: string | null;
  drafts: DraftResult[];
  isDrafting: boolean;
  draftProgress: { done: number; total: number };
  draftError: string | null;
  outreachConfig: OutreachConfig;
  sendResults: SendResult[];
  isSending: boolean;
  sendProgress: { done: number; total: number };
  setActiveTab: (tab: Tab) => void;
  setEmails: (emails: EmailRow[]) => void;
  setValidating: (v: boolean) => void;
  setProgress: (done: number, total: number) => void;
  appendResults: (batch: EmailResult[]) => void;
  markResultValid: (email: string) => void;
  markAllFlaggedValid: () => void;
  setError: (msg: string | null) => void;
  setOutreachConfig: (config: OutreachConfig) => void;
  setDrafting: (v: boolean) => void;
  setDraftProgress: (done: number, total: number) => void;
  appendDrafts: (batch: DraftResult[]) => void;
  setDraftError: (msg: string | null) => void;
  clearDrafts: () => void;
  updateDraft: (email: string, patch: Partial<Pick<DraftResult, "subject" | "body">>) => void;
  setSending: (v: boolean) => void;
  setSendProgress: (done: number, total: number) => void;
  appendSendResults: (batch: SendResult[]) => void;
  clearSendResults: () => void;
  reset: () => void;
}

export const useValidatorStore = create<ValidatorState>((set) => ({
  activeTab: "upload",
  emails: [],
  results: [],
  isValidating: false,
  progress: { done: 0, total: 0 },
  error: null,
  drafts: [],
  isDrafting: false,
  draftProgress: { done: 0, total: 0 },
  draftError: null,
  outreachConfig: EMPTY_OUTREACH_CONFIG,
  sendResults: [],
  isSending: false,
  sendProgress: { done: 0, total: 0 },
  setActiveTab: (tab) => set({ activeTab: tab }),
  setEmails: (emails) => set({ emails, results: [], error: null }),
  setValidating: (v) => set({ isValidating: v }),
  setProgress: (done, total) => set({ progress: { done, total } }),
  appendResults: (batch) => set((s) => ({ results: [...s.results, ...batch] })),
  markResultValid: (email) =>
    set((s) => ({
      results: s.results.map((r) =>
        r.email === email ? { ...r, status: "valid", reason: "Manually verified by user" } : r
      ),
    })),
  markAllFlaggedValid: () =>
    set((s) => ({
      results: s.results.map((r) =>
        r.status === "flagged" ? { ...r, status: "valid", reason: "Manually verified by user" } : r
      ),
    })),
  setError: (msg) => set({ error: msg }),
  setOutreachConfig: (config) => set({ outreachConfig: config }),
  setDrafting: (v) => set({ isDrafting: v }),
  setDraftProgress: (done, total) => set({ draftProgress: { done, total } }),
  appendDrafts: (batch) => set((s) => ({ drafts: [...s.drafts, ...batch] })),
  setDraftError: (msg) => set({ draftError: msg }),
  clearDrafts: () => set({ drafts: [], draftProgress: { done: 0, total: 0 }, draftError: null }),
  updateDraft: (email, patch) =>
    set((s) => ({
      drafts: s.drafts.map((d) => (d.email === email ? { ...d, ...patch } : d)),
    })),
  setSending: (v) => set({ isSending: v }),
  setSendProgress: (done, total) => set({ sendProgress: { done, total } }),
  appendSendResults: (batch) => set((s) => ({ sendResults: [...s.sendResults, ...batch] })),
  clearSendResults: () => set({ sendResults: [], sendProgress: { done: 0, total: 0 } }),
  reset: () =>
    set({
      emails: [],
      results: [],
      isValidating: false,
      progress: { done: 0, total: 0 },
      error: null,
      drafts: [],
      isDrafting: false,
      draftProgress: { done: 0, total: 0 },
      draftError: null,
      sendResults: [],
      isSending: false,
      sendProgress: { done: 0, total: 0 },
      activeTab: "upload",
    }),
}));
