import axios, { isAxiosError } from "axios";
import { isDisposableDomain } from "./disposable-domains";
import type { EmailResult, EmailRow, EmailStatus } from "./store";
import {
  extractDomain,
  extractLocalPart,
  isRoleBased,
  isSpamTrapPattern,
  isValidFormat,
} from "./utils";

const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";
const MODEL = "llama-3.1-8b-instant";
const BATCH_SIZE = 20;

function heuristicCheck(row: EmailRow): EmailResult {
  const { email } = row;
  if (!isValidFormat(email)) {
    return { ...row, status: "invalid", reason: "Malformed email address" };
  }
  const domain = extractDomain(email);
  const local = extractLocalPart(email);

  if (isDisposableDomain(domain)) {
    return { ...row, status: "invalid", reason: "Disposable/temporary email domain" };
  }
  if (isSpamTrapPattern(email)) {
    return { ...row, status: "invalid", reason: "Spam trap pattern (noreply address)" };
  }
  if (isRoleBased(local)) {
    return { ...row, status: "flagged", reason: "Role-based address, likely low engagement" };
  }
  return { ...row, status: "valid", reason: "Passes format and domain checks" };
}

async function callGroq(batch: EmailResult[], apiKey: string): Promise<EmailResult[]> {
  const prompt = `You are an email deliverability classifier. Each line below is an email with a preliminary heuristic verdict. Confirm it, or correct it if you spot a fake/gibberish local part, a likely spam trap, or a domain that looks like a placeholder/example rather than a real mailbox.

Respond ONLY with JSON of the form {"results":[{"email":"...","status":"valid"|"invalid"|"flagged","reason":"short reason, under 8 words"}]}, one entry per email below, same order.

${batch.map((b) => `${b.email} | heuristic: ${b.status} (${b.reason})`).join("\n")}`;

  try {
    const res = await axios.post(
      GROQ_URL,
      {
        model: MODEL,
        messages: [{ role: "user", content: prompt }],
        temperature: 0,
        response_format: { type: "json_object" },
      },
      {
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        timeout: 30000,
      }
    );

    const content = res.data?.choices?.[0]?.message?.content;
    if (!content) throw new Error("Invalid response format from Groq API");

    let parsed: { results?: Array<{ email: string; status: string; reason: string }> };
    try {
      parsed = JSON.parse(content);
    } catch {
      throw new Error("Invalid response format from Groq API");
    }
    if (!Array.isArray(parsed.results)) {
      throw new Error("Invalid response format from Groq API");
    }

    const byEmail = new Map(parsed.results.map((r) => [r.email.toLowerCase(), r]));
    return batch.map((b) => {
      const match = byEmail.get(b.email.toLowerCase());
      const validStatus = ["valid", "invalid", "flagged"].includes(match?.status ?? "");
      if (!match || !validStatus) return b;
      return { ...b, status: match.status as EmailStatus, reason: match.reason || b.reason };
    });
  } catch (err) {
    if (isAxiosError(err)) {
      if (err.response?.status === 401) {
        throw new Error("Groq API error: 401 Unauthorized — check NEXT_PUBLIC_GROQ_API_KEY in .env.local");
      }
      if (err.response?.status === 429) {
        const rateLimitErr = new Error("Groq API rate limited (429)");
        rateLimitErr.name = "RateLimit";
        throw rateLimitErr;
      }
    }
    throw err;
  }
}

async function deepVerifyBatch(batch: EmailResult[]): Promise<EmailResult[]> {
  const candidates = batch.filter((b) => b.status !== "invalid");
  if (candidates.length === 0) return batch;

  try {
    const res = await axios.post<{ results: Array<{ email: string; status: EmailStatus; reason: string }> }>(
      "/api/verify-email",
      { emails: candidates.map((c) => c.email) },
      { timeout: 120000 }
    );
    const byEmail = new Map(res.data.results.map((r) => [r.email.toLowerCase(), r]));
    return batch.map((b) => {
      const deep = byEmail.get(b.email.toLowerCase());
      return deep ? { ...b, status: deep.status, reason: deep.reason } : b;
    });
  } catch {
    // MX/SMTP check unavailable (network issue, server down) — keep heuristic result
    return batch;
  }
}

async function callGroqWithRetry(
  batch: EmailResult[],
  apiKey: string,
  retries = 2
): Promise<EmailResult[]> {
  try {
    return await callGroq(batch, apiKey);
  } catch (err) {
    if (err instanceof Error && err.name === "RateLimit" && retries > 0) {
      await new Promise((r) => setTimeout(r, 15000));
      return callGroqWithRetry(batch, apiKey, retries - 1);
    }
    if (err instanceof Error && err.message.startsWith("Groq API error: 401")) {
      throw err;
    }
    // Groq unavailable/rate-limited past retries — fall back to heuristic-only results
    return batch;
  }
}

export async function validateEmails(
  rows: EmailRow[],
  onProgress: (done: number, total: number) => void
): Promise<EmailResult[]> {
  const apiKey = process.env.NEXT_PUBLIC_GROQ_API_KEY;
  if (!apiKey) {
    throw new Error(
      "NEXT_PUBLIC_GROQ_API_KEY is not set — add it to .env.local and restart the dev server"
    );
  }

  const results: EmailResult[] = [];
  let done = 0;

  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const heuristicBatch = rows.slice(i, i + BATCH_SIZE).map(heuristicCheck);
    const batch = await deepVerifyBatch(heuristicBatch);
    const final = await callGroqWithRetry(batch, apiKey);
    results.push(...final);
    done += batch.length;
    onProgress(done, rows.length);
  }

  return results;
}
