import axios, { isAxiosError } from "axios";
import type { DraftResult, EmailResult, OutreachConfig } from "./store";

const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";
const MODEL = "llama-3.1-8b-instant";
const BATCH_SIZE = 8;

function formatHookLines(hook: string): string | null {
  const lines = hook.split("\n").map((line) => line.trim()).filter(Boolean);
  if (lines.length >= 2) {
    return `${lines[0]}\n${lines.slice(1).join(" ")}`;
  }
  if (lines.length === 1) {
    const match = lines[0].match(/^([\s\S]*?[.!?])\s+([\s\S]*)$/);
    if (match) {
      const line1 = match[1].trim();
      const line2 = match[2].trim();
      if (line1 && line2) return `${line1}\n${line2}`;
    }
  }
  return null;
}

function buildEleviqueBody(
  pocName: string,
  openingHook: string,
  config: OutreachConfig
): string {
  const nameGreeting = pocName ? pocName : "there";
  const proofLine = config.proofPoints
    ? (config.proofPoints.startsWith("http") || config.proofPoints.startsWith("www")
        ? `A few recent projects are here:\n${config.proofPoints}`
        : config.proofPoints)
    : "A few recent projects are here:\nwww.elevique.in/portfolio";

  const ctaText =
    config.cta ||
    "If you feel it's worth a 15-minute walkthrough, please confirm your availability for a Google Meet or phone call this week. Alternatively, if someone else on your team handles content, advertising or marketing, we'd be happy to take it up with them—just point us in the right direction.";

  const pitchText =
    config.pitch ||
    "Elevique creates and manages brand films, social media content and campaigns for brands like yours using AI-native production.\n\nThe best part?\nIt's not like generic AI visuals but concepts that actually perform.";

  return `Hi ${nameGreeting},

${openingHook}

${pitchText}
${proofLine}

${ctaText}

${config.signature}`;
}

function fallbackDraft(contact: EmailResult, config: OutreachConfig): DraftResult {
  const brandName = contact.brand || "your team";
  const openingHook = `Just wanted to check how is your content currently performing for the brand?\nWe've been following ${brandName}'s work in the ${contact.category || "content"} space, and we'd love to explore creating cinematic AI visuals that help its campaigns stand out.`;

  return {
    email: contact.email,
    pocName: contact.pocName,
    brand: contact.brand,
    subject: `Noticed something about ${brandName}'s content`,
    body: buildEleviqueBody(contact.pocName, openingHook, config),
  };
}

async function callGroq(
  batch: EmailResult[],
  config: OutreachConfig,
  apiKey: string
): Promise<DraftResult[]> {
  const prompt = `You are writing tailored cold outreach opening hooks on behalf of ${config.senderName} at ${config.company}, which creates and manages brand films, social media content and campaigns using AI-native production.

For each contact below, write:
1. A concise personalized subject line matching this exact format: "Noticed something about {Brand}'s content "
2. A short 2-line opening hook. Pick ONE of these 4 approved hook structures per contact, and lightly reword it so it reads naturally for that specific brand — you may adjust the wording, but keep the same 2-line structure, meaning, and approximate length as the version you pick:

Version 1:
Line 1: "Just wanted to check how is your content currently performing for the brand?"
Line 2: "We've been following {Brand}'s work in {category/space}, and we'd love to explore creating cinematic AI visuals that help its campaigns stand out."

Version 2:
Line 1: "Does your current content fully reflect the kind of brand you're building?"
Line 2: "We came across {Brand}'s recent work around {category/space}, and saw strong potential to extend it through more cinematic and distinctive visual storytelling."

Version 3:
Line 1: "Is your content only looking good, or is it also helping the brand get noticed?"
Line 2: "{Brand} already has a strong presence in {category/space}, and we'd love to explore AI-led campaign visuals that can make its communication more memorable and effective."

Version 4:
Line 1: "Your brand may already have the right story—the content can take it much further."
Line 2: "We've been following {Brand}'s work in {category/space}, and believe its identity could translate beautifully into cinematic AI films and campaign-led social content."

Rules for picking and filling in the hook:
   - Rotate across the contacts in this batch so you use a mix of all 4 versions — do not use the same version for two contacts in a row, and spread all 4 roughly evenly across the batch.
   - Replace {Brand} with the contact's actual brand name, and replace {category/space} with something grounded in the contact's actual Category field (e.g. "the music space", "the VFX industry") — do NOT invent a specific named project, campaign, artist, or collaboration you can't verify; stay general about the specific work being referenced.
   - Keep each hook to exactly 2 lines, matching the structure of the version you picked.

DO NOT write the full pitch, proof points, call to action, signature, or links. Only generate the subject and the 2-line hook described above.

Respond ONLY with JSON of the form {"drafts":[{"email":"...","subject":"...","openingHook":"..."}]}, one entry per contact below, same order. The "openingHook" field should contain the 2-line hook as a single string, with a newline character between line 1 and line 2.

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
        temperature: 0.85,
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
      const defaultHook = `Just wanted to check how is your content currently performing for the brand?\nWe've been following ${brandName}'s work in the ${c.category || "content"} space, and we'd love to explore creating cinematic AI visuals that help its campaigns stand out.`;
      const rawHook = match?.openingHook || match?.body || defaultHook;
      const hook = formatHookLines(rawHook) ?? defaultHook;
      const subject = `Noticed something about ${brandName}'s content`;

      return {
        email: c.email,
        pocName: c.pocName,
        brand: c.brand,
        subject,
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
