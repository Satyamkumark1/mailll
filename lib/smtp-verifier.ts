import dns from "dns/promises";
import net from "net";
import type { EmailStatus } from "./store";

// Server-only: raw DNS/SMTP probing needs Node's dns/net modules, unavailable
// in the browser. Only import this from route handlers, never from client code.

const SMTP_TIMEOUT_MS = 8000;
const PROBE_FROM = "verify-bounce@example.com";

export interface DeepVerifyResult {
  status: EmailStatus;
  reason: string;
}

async function getMxHosts(domain: string): Promise<string[]> {
  try {
    const records = await dns.resolveMx(domain);
    if (records.length > 0) {
      return records.sort((a, b) => a.priority - b.priority).map((r) => r.exchange);
    }
  } catch {
    // no MX — fall through to the A/AAAA fallback RFC 5321 allows
  }
  try {
    await dns.resolve4(domain);
    return [domain];
  } catch {
    /* no A record */
  }
  try {
    await dns.resolve6(domain);
    return [domain];
  } catch {
    return [];
  }
}

// Buffers raw SMTP replies into complete (possibly multi-line) responses.
// Any socket error/timeout/close resolves pending reads with "" rather than
// throwing, so a dead connection just reads as a failed response everywhere.
class SmtpLineReader {
  private buffer = "";
  private lines: string[] = [];
  private waiters: Array<(line: string) => void> = [];
  private closed = false;

  constructor(socket: net.Socket) {
    socket.on("data", (chunk) => this.onData(chunk));
    const bail = () => this.bail();
    socket.on("error", bail);
    socket.on("timeout", bail);
    socket.on("close", bail);
  }

  private bail() {
    if (this.closed) return;
    this.closed = true;
    while (this.waiters.length) this.waiters.shift()!("");
  }

  private onData(chunk: Buffer) {
    this.buffer += chunk.toString("utf8");
    let idx: number;
    while ((idx = this.buffer.indexOf("\n")) !== -1) {
      const raw = this.buffer.slice(0, idx);
      this.buffer = this.buffer.slice(idx + 1);
      const line = raw.endsWith("\r") ? raw.slice(0, -1) : raw;
      this.lines.push(line);
      if (/^\d{3} /.test(line)) {
        const full = this.lines.join("\n");
        this.lines = [];
        this.waiters.shift()?.(full);
      }
    }
  }

  readResponse(): Promise<string> {
    if (this.closed) return Promise.resolve("");
    return new Promise((resolve) => this.waiters.push(resolve));
  }
}

interface ProbeResult {
  mailboxOk: boolean;
  // One entry per random probe address — kept separate (not collapsed to a
  // single boolean) so a mail server that answers them inconsistently within
  // the same session can be told apart from one that's genuinely catch-all.
  probeAccepted: boolean[];
  unreachable: boolean;
}

// Speaks just enough SMTP to ask the mail server whether it would accept the
// target address, then asks again for N random addresses at the same domain
// (catch-all check). Never sends DATA, so no email is actually delivered.
function smtpConversation(host: string, targetEmail: string, probeEmails: string[]): Promise<ProbeResult> {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host, port: 25 });
    socket.setTimeout(SMTP_TIMEOUT_MS);
    socket.on("timeout", () => socket.destroy());
    const reader = new SmtpLineReader(socket);

    const finish = (result: ProbeResult) => {
      socket.destroy();
      resolve(result);
    };
    const unreachable = { mailboxOk: false, probeAccepted: [], unreachable: true };

    (async () => {
      const greeting = await reader.readResponse();
      if (!greeting.startsWith("220")) return finish(unreachable);

      socket.write("EHLO verifier.local\r\n");
      const ehlo = await reader.readResponse();
      if (!ehlo.startsWith("2")) return finish(unreachable);

      socket.write(`MAIL FROM:<${PROBE_FROM}>\r\n`);
      const mailFrom = await reader.readResponse();
      if (!mailFrom.startsWith("2")) return finish(unreachable);

      socket.write(`RCPT TO:<${targetEmail}>\r\n`);
      const rcptTarget = await reader.readResponse();
      const mailboxOk = rcptTarget.startsWith("2");

      const probeAccepted: boolean[] = [];
      for (const probeEmail of probeEmails) {
        socket.write(`RCPT TO:<${probeEmail}>\r\n`);
        const rcptProbe = await reader.readResponse();
        probeAccepted.push(rcptProbe.startsWith("2"));
      }

      socket.write("QUIT\r\n");
      finish({ mailboxOk, probeAccepted, unreachable: false });
    })();
  });
}

function randomLocalPart(): string {
  return `verify-probe-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

const CATCH_ALL_PROBES = 2;
const INVALID_RETRY_DELAY_MS = 5000;

// Consumer webmail providers documented (and, for yahoo.co.in, directly
// observed in testing) to give unreliable or IP-blocked RCPT-time signals —
// probing them burns ~15s per address for a result that can't be trusted
// anyway. Gmail is deliberately excluded: our own testing showed it gives
// consistent, reliable per-mailbox rejections.
const UNRELIABLE_RCPT_DOMAINS = new Set([
  "outlook.com", "hotmail.com", "live.com", "msn.com",
  "yahoo.com", "yahoo.co.in", "yahoo.co.uk", "ymail.com", "aol.com",
]);

// Caches domain-level "this domain can't give a trustworthy per-mailbox
// signal" conclusions (no MX, catch-all, inconsistent, unreachable) so a CSV
// with many contacts at the same bad domain doesn't re-probe it every row.
// Deliberately never caches a "valid"/"invalid" verdict for one specific
// mailbox — only facts that hold for every address at that domain, so caching
// can only make results faster, never less accurate.
const domainVerdictCache = new Map<string, { result: DeepVerifyResult; cachedAt: number }>();
const DOMAIN_CACHE_TTL_MS = 30 * 60 * 1000;

function getCachedDomainVerdict(domain: string): DeepVerifyResult | null {
  const entry = domainVerdictCache.get(domain);
  if (!entry) return null;
  if (Date.now() - entry.cachedAt > DOMAIN_CACHE_TTL_MS) {
    domainVerdictCache.delete(domain);
    return null;
  }
  return entry.result;
}

function cacheDomainVerdict(domain: string, result: DeepVerifyResult): DeepVerifyResult {
  domainVerdictCache.set(domain, { result, cachedAt: Date.now() });
  return result;
}

async function deepVerifyOnce(email: string, domain: string): Promise<DeepVerifyResult> {
  const cached = getCachedDomainVerdict(domain);
  if (cached) return cached;

  const mxHosts = await getMxHosts(domain);
  if (mxHosts.length === 0) {
    return cacheDomainVerdict(domain, { status: "invalid", reason: "Domain has no mail server (no MX/A record)" });
  }

  const probeEmails = Array.from({ length: CATCH_ALL_PROBES }, () => `${randomLocalPart()}@${domain}`);

  // ponytail: only the top 2 MX hosts are tried before giving up as
  // "unreachable" — bump this if too many results come back inconclusive
  for (const host of mxHosts.slice(0, 2)) {
    const result = await smtpConversation(host, email, probeEmails);
    if (result.unreachable) continue;

    const acceptedCount = result.probeAccepted.filter(Boolean).length;
    if (acceptedCount === result.probeAccepted.length) {
      // every random, nonexistent address was also accepted — the server
      // doesn't actually validate mailboxes (catch-all, or anti-harvesting
      // "accept everything" policy, common on Microsoft 365/shared hosting)
      return cacheDomainVerdict(domain, {
        status: "flagged",
        reason: "Catch-all domain — mailbox cannot be individually confirmed",
      });
    }
    if (acceptedCount > 0) {
      // some random addresses accepted, some rejected, in the same session —
      // the server's RCPT-time answers aren't self-consistent, so the
      // "mailbox exists" signal can't be trusted either way
      return cacheDomainVerdict(domain, {
        status: "flagged",
        reason: "Mail server gave inconsistent responses — result inconclusive",
      });
    }
    // none of the random addresses were accepted — this server does appear
    // to validate individual mailboxes, so trust its answer for the real one
    // (per-mailbox verdict — deliberately not cached at the domain level)
    if (!result.mailboxOk) {
      return { status: "invalid", reason: "SMTP rejected — mailbox does not exist" };
    }
    return { status: "valid", reason: "SMTP confirmed mailbox exists (MX + RCPT check)" };
  }

  return cacheDomainVerdict(domain, {
    status: "flagged",
    reason: "SMTP verification unreachable — port 25 may be blocked on this network",
  });
}

// A single "invalid" reading can be a transient hiccup (greylisting, a
// momentary connection reset) rather than a genuinely dead mailbox — so
// before finalizing an invalid verdict, wait and check again. Two independent
// attempts agreeing is a much stronger signal than one. Skipped when the
// result turns out to be a cached domain-level fact (no MX, catch-all, etc.)
// since re-checking those can't produce a different answer.
export async function deepVerify(email: string): Promise<DeepVerifyResult> {
  const domain = email.split("@")[1]?.toLowerCase();
  if (!domain) return { status: "invalid", reason: "Malformed email address" };

  if (UNRELIABLE_RCPT_DOMAINS.has(domain)) {
    return { status: "flagged", reason: "Provider known to give unreliable SMTP signals — verify this one manually" };
  }

  const cached = getCachedDomainVerdict(domain);
  if (cached) return cached;

  const first = await deepVerifyOnce(email, domain);
  if (first.status !== "invalid" || getCachedDomainVerdict(domain)) return first;

  await new Promise((r) => setTimeout(r, INVALID_RETRY_DELAY_MS));
  const second = await deepVerifyOnce(email, domain);
  if (getCachedDomainVerdict(domain)) return second;

  if (second.status === "invalid") {
    return { ...first, reason: `${first.reason} (confirmed on retry)` };
  }
  return { ...second, reason: `${second.reason} (first attempt said invalid — retry overturned it)` };
}
