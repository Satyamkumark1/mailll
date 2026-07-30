import axios, { isAxiosError } from "axios";
import type { DraftResult, EmailResult, OutreachConfig } from "./store";

const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";
const MODEL = "llama-3.1-8b-instant";
const BATCH_SIZE = 8;

// CAN-SPAM requires a clear opt-out mechanism and a valid postal address on
// every commercial email — appended here so it's guaranteed present regardless
// of whether Groq or the fallback template produced the body.
function complianceFooter(config: OutreachConfig): string {
  if (!config.businessAddress) return "";
  return `\n\nIf you'd rather not hear from us again, just reply and let us know.\n${config.businessAddress}`;
}

function buildEleviqueBody(
  pocName: string,
  openingHook: string,
  config: OutreachConfig
): string {
  const nameGreeting = pocName ? pocName : "there";
  const proofLine = config.proofPoints
    ? (config.proofPoints.startsWith("http") || config.proofPoints.startsWith("www")
        ? `A few recent projects are here: ${config.proofPoints}`
        : config.proofPoints)
    : "A few recent projects are here: www.elevique.in/portfolio";

  const ctaText =
    config.cta ||
    "If you feel it's worth a 15-minute walkthrough, please confirm your availability for a Google Meet or phone call this week. Alternatively, if someone on your team handles content and ads marketing, happy to take it up with them – just point me their way.";

  const pitchText =
    config.pitch ||
    "Elevique produces brand films and social content for companies like yours, using AI-native production. And because we think like marketers, not just filmmakers, the work is built to perform, not just to look good.";

  return `Hi ${nameGreeting},

${openingHook}
${pitchText}

${proofLine}

${ctaText}

${config.signature}${complianceFooter(config)}`;
}

function fallbackDraft(contact: EmailResult, config: OutreachConfig): DraftResult {
  const brandName = contact.brand || "your team";
  const openingHook = `${brandName} frequent collection drops demand a constant flow of premium campaign creatives something traditional shoots often struggle to scale.`;

  return {
    email: contact.email,
    pocName: contact.pocName,
    brand: contact.brand,
    subject: `Noticed something about ${brandName}'s content ↗`,
    body: buildEleviqueBody(contact.pocName, openingHook, config),
  };
}

async function callGroq(
  batch: EmailResult[],
  config: OutreachConfig,
  apiKey: string
): Promise<DraftResult[]> {
  const prompt = `You are writing tailored cold outreach opening hooks on behalf of ${config.senderName} at ${config.company}.

For each contact below, write:
1. A concise personalized subject line matching this exact format: "Noticed something about {Brand}'s content ↗"
2. A single opening hook sentence (under 30 words) that connects the recipient brand ({Brand}) and category ({Category}) to their constant demand for premium campaign creatives and the challenge of scaling traditional shoots.

DO NOT write the full body, call to action, signature, or links. Only generate the subject and opening hook.

Respond ONLY with JSON of the form {"drafts":[{"email":"...","subject":"...","openingHook":"..."}]}, one entry per contact below, same order.

Contacts:
${batch
  .map(
    (c) =>
      `${c.email} | Name: ${c.pocName || "Unknown"} | Brand: ${c.brand || "Unknown"} | Role: ${c.pocDesignation || "Unknown"} | Category: ${c.category || "Unknown"}`
  )
  .join("\n")}`;

  try {
    const res = await axios.post(
      GROQ_URL,
      {
        model: MODEL,
        messages: [{ role: "user", content: prompt }],
        temperature: 0.6,
        response_format: { type: "json_object" },
      },
      {
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        timeout: 45000,
      }
    );

    const content = res.data?.choices?.[0]?.message?.content;
    if (!content) throw new Error("Invalid response format from Groq API");

    let parsed: { drafts?: Array<{ email: string; subject: string; openingHook?: string; body?: string }> };
    try {
      parsed = JSON.parse(content);
    } catch {
      throw new Error("Invalid response format from Groq API");
    }
    if (!Array.isArray(parsed.drafts)) {
      throw new Error("Invalid response format from Groq API");
    }

    const byEmail = new Map(parsed.drafts.map((d) => [d.email.toLowerCase(), d]));
    return batch.map((c) => {
      const match = byEmail.get(c.email.toLowerCase());
      const brandName = c.brand || "your team";
      const defaultHook = `${brandName} frequent collection drops demand a constant flow of premium campaign creatives something traditional shoots often struggle to scale.`;
      const hook = match?.openingHook || match?.body || defaultHook;
      const subject = match?.subject || `Noticed something about ${brandName}'s content ↗`;

      return {
        email: c.email,
        pocName: c.pocName,
        brand: c.brand,
        subject: subject,
        body: buildEleviqueBody(c.pocName, hook, config),
      };
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

async function callGroqWithRetry(
  batch: EmailResult[],
  config: OutreachConfig,
  apiKey: string,
  retries = 2
): Promise<DraftResult[]> {
  try {
    return await callGroq(batch, config, apiKey);
  } catch (err) {
    if (err instanceof Error && err.name === "RateLimit" && retries > 0) {
      await new Promise((r) => setTimeout(r, 15000));
      return callGroqWithRetry(batch, config, apiKey, retries - 1);
    }
    if (err instanceof Error && err.message.startsWith("Groq API error: 401")) {
      throw err;
    }
    // Groq unavailable/rate-limited past retries — fall back to a plain templated draft
    return batch.map((c) => fallbackDraft(c, config));
  }
}

export async function generateDrafts(
  contacts: EmailResult[],
  config: OutreachConfig,
  onProgress: (done: number, total: number) => void
): Promise<DraftResult[]> {
  const apiKey = process.env.NEXT_PUBLIC_GROQ_API_KEY;
  if (!apiKey) {
    throw new Error(
      "NEXT_PUBLIC_GROQ_API_KEY is not set — add it to .env.local and restart the dev server"
    );
  }

  const drafts: DraftResult[] = [];
  let done = 0;

  for (let i = 0; i < contacts.length; i += BATCH_SIZE) {
    const batch = contacts.slice(i, i + BATCH_SIZE);
    const final = await callGroqWithRetry(batch, config, apiKey);
    drafts.push(...final);
    done += batch.length;
    onProgress(done, contacts.length);
  }

  return drafts;
}
