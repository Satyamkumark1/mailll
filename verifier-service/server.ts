import http from "http";
import { deepVerify } from "../lib/smtp-verifier";
import { mapWithConcurrency } from "../lib/concurrency";

const PORT = Number(process.env.PORT) || 4000;
const SHARED_SECRET = process.env.VERIFIER_SHARED_SECRET;
const CONCURRENCY = 5;

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => resolve(body));
    req.on("error", reject);
  });
}

function send(res: http.ServerResponse, status: number, payload: unknown) {
  res.writeHead(status, { "Content-Type": "application/json" }).end(JSON.stringify(payload));
}

export const server = http.createServer(async (req, res) => {
  if (req.method !== "POST") return send(res, 405, { error: "POST only" });

  if (SHARED_SECRET && req.headers.authorization !== `Bearer ${SHARED_SECRET}`) {
    return send(res, 401, { error: "Unauthorized" });
  }

  try {
    const { emails } = JSON.parse(await readBody(req));
    if (!Array.isArray(emails) || emails.length === 0) {
      return send(res, 400, { error: "emails must be a non-empty array" });
    }

    const results = await mapWithConcurrency(emails as string[], CONCURRENCY, async (email) => ({
      email,
      ...(await deepVerify(email)),
    }));
    send(res, 200, { results });
  } catch (err) {
    send(res, 500, { error: err instanceof Error ? err.message : "verify failed" });
  }
});

if (require.main === module) {
  server.listen(PORT, () => console.log(`verifier-service listening on :${PORT}`));
}
