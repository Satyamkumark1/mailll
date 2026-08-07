import Papa from "papaparse";
import type { DraftResult, EmailResult, EmailRow } from "./store";

export function cn(...classes: Array<string | false | null | undefined>): string {
  return classes.filter(Boolean).join(" ");
}

// Drafts are generated as a snapshot of the valid-contacts list. Anything that grows
// that list afterwards (e.g. bulk-approving flagged emails) makes the snapshot stale
// until the user explicitly regenerates — otherwise newly-valid contacts silently
// never receive a drafted email even though the Send stage looks "ready".
export function computeDraftsStale(
  validContacts: { email: string }[],
  drafts: { email: string }[]
): boolean {
  if (drafts.length === 0) return false;
  const draftEmails = new Set(drafts.map((d) => d.email));
  return validContacts.some((contact) => !draftEmails.has(contact.email));
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isValidFormat(email: string): boolean {
  return EMAIL_RE.test(email.trim());
}

export function extractDomain(email: string): string {
  return email.trim().toLowerCase().split("@")[1] ?? "";
}

export function extractLocalPart(email: string): string {
  return email.trim().toLowerCase().split("@")[0] ?? "";
}

const ROLE_LOCAL_PARTS = new Set([
  "admin", "support", "info", "sales", "contact", "help", "billing",
  "webmaster", "postmaster", "hostmaster", "abuse", "office", "team",
]);

const SPAM_TRAP_LOCAL = /^(noreply|no-reply|donotreply|do-not-reply)/i;
const SPAM_TRAP_DOMAIN = /(^|\.)(noreply|no-reply)\./i;

export function isRoleBased(localPart: string): boolean {
  return ROLE_LOCAL_PARTS.has(localPart.toLowerCase());
}

export function isSpamTrapPattern(email: string): boolean {
  const local = extractLocalPart(email);
  const domain = extractDomain(email);
  return SPAM_TRAP_LOCAL.test(local) || SPAM_TRAP_DOMAIN.test(`${domain}.`);
}

function findColumn(row: Record<string, string>, ...aliases: string[]): string {
  const entries = Object.entries(row);
  for (const alias of aliases) {
    const needle = alias.toLowerCase().replace(/[\s_]+/g, "");
    const hit = entries.find(([k]) => k.toLowerCase().replace(/[\s_]+/g, "").includes(needle));
    if (hit && hit[1]) return hit[1].trim();
  }
  return "";
}

export interface ParsedCsv {
  rows: EmailRow[];
  totalRows: number;
  skippedMissingEmail: number;
  skippedDuplicate: number;
}

export function parseEmailCsv(file: File): Promise<ParsedCsv> {
  return new Promise((resolve, reject) => {
    Papa.parse<Record<string, string>>(file, {
      header: true,
      skipEmptyLines: true,
      complete: (result) => {
        const data = result.data;
        const hasEmailHeader = Object.keys(data[0] ?? {}).some((k) =>
          k.toLowerCase().includes("email")
        );
        const seen = new Set<string>();
        const rows: EmailRow[] = [];
        let skippedMissingEmail = 0;
        let skippedDuplicate = 0;
        for (const row of data) {
          const email = (hasEmailHeader ? findColumn(row, "email") : Object.values(row)[0] ?? "").trim();
          if (!email) {
            skippedMissingEmail++;
            continue;
          }
          if (seen.has(email.toLowerCase())) {
            skippedDuplicate++;
            continue;
          }
          seen.add(email.toLowerCase());
          rows.push({
            email,
            brand: findColumn(row, "brand"),
            category: findColumn(row, "category"),
            linkedinUrl: findColumn(row, "linkedin_url", "linkedin"),
            pocName: findColumn(row, "poc_name"),
            pocDesignation: findColumn(row, "poc_designation"),
          });
        }
        resolve({ rows, totalRows: data.length, skippedMissingEmail, skippedDuplicate });
      },
      error: (err: Error) => reject(err),
    });
  });
}

export function resultsToCsv(results: EmailResult[]): string {
  return Papa.unparse(
    results.map((r) => ({
      email: r.email,
      status: r.status,
      reason: r.reason,
      brand: r.brand,
      category: r.category,
      linkedin_url: r.linkedinUrl,
      poc_name: r.pocName,
      poc_designation: r.pocDesignation,
    }))
  );
}

export function draftsToCsv(drafts: DraftResult[]): string {
  return Papa.unparse(
    drafts.map((d) => ({
      email: d.email,
      poc_name: d.pocName,
      brand: d.brand,
      subject: d.subject,
      body: d.body,
    }))
  );
}

export function downloadCsv(filename: string, csv: string) {
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function draftsToText(drafts: DraftResult[]): string {
  return drafts
    .map((d) => `To: ${d.email}\nSubject: ${d.subject}\n\n${d.body}`)
    .join(`\n\n${"-".repeat(40)}\n\n`);
}

export function downloadTextFile(filename: string, text: string) {
  const blob = new Blob([text], { type: "text/plain;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
