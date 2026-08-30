import { neon, type NeonQueryFunction } from "@neondatabase/serverless";

// Server-only. Never import from client code.
let client: NeonQueryFunction<false, false> | null = null;

function getClient(): NeonQueryFunction<false, false> {
  if (!client) {
    const url = process.env.DATABASE_URL;
    if (!url) {
      throw new Error("DATABASE_URL is not set — background send campaigns require a Postgres database.");
    }
    client = neon(url);
  }
  return client;
}

// Lazily initializes the connection on first query rather than at import
// time, so importing this module (e.g. transitively, in tests or during
// `next build`) never throws just because DATABASE_URL isn't configured yet.
export function sql(strings: TemplateStringsArray, ...values: unknown[]) {
  return getClient()(strings, ...values);
}

// Runs multiple `sql`-built queries as one non-interactive Postgres
// transaction (the Neon HTTP driver has no interactive/multi-round-trip
// transactions, so all statements must be built up front — no branching in
// JS between them). Build each entry with `sql` without awaiting it. Used
// where a read-then-write needs to be atomic — see
// lib/send-rate-limiter.ts's reserveSendSlot.
export function sqlTransaction(queries: ReturnType<typeof sql>[]) {
  return getClient().transaction(queries);
}
