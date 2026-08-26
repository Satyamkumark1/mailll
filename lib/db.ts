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
