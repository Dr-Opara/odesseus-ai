import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * Local-stack credentials for the browser suite.
 *
 * Playwright loads `.env`, not `.env.local`, and the pinned local Supabase
 * stack this repo runs against is described entirely by `.env.local` (see
 * docs/development/final-rc-integration-testing.md, which uses
 * `node --env-file=.env.local` for the same reason). Without this, any test
 * that needs the service role silently skips itself, which is the worst
 * possible outcome: a skipped test reads as coverage that does not exist.
 *
 * `.env.local` is gitignored, is a local-stack value, and is read here only by
 * the test process. Anything already exported wins, so CI can supply real
 * environment variables instead. Returns null when the value is genuinely
 * absent, which is the signal to skip rather than to fail.
 */
function readLocalEnv(key: string): string | null {
  const fromProcess = process.env[key];
  if (fromProcess) return fromProcess;

  try {
    const file = path.join(process.cwd(), ".env.local");
    for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
      const match = /^([A-Za-z0-9_]+)=(.*)$/.exec(line.trim());
      if (match && match[1] === key) {
        const value = match[2].trim().replace(/^["']|["']$/g, "");
        return value ? value : null;
      }
    }
  } catch {
    // No .env.local: this environment has no local stack to talk to.
  }
  return null;
}

/** The local Supabase URL, defaulting to the address `supabase start` serves. */
export function localSupabaseUrl(): string {
  return readLocalEnv("NEXT_PUBLIC_SUPABASE_URL") ?? "http://127.0.0.1:54321";
}

/**
 * Whether an OpenAI key is configured.
 *
 * Used to state honestly what a Live test could and could not reach: with a key
 * the realtime connection is real, and with none the provider boundary is where
 * the run stops. Never the key itself.
 */
export function hasOpenAiKey(): boolean {
  return Boolean(readLocalEnv("OPENAI_API_KEY"));
}

/**
 * The service-role key, or null when it is not configured.
 *
 * Null is a legitimate state (a CI runner with no local Supabase) and callers
 * must skip rather than fail when they see it. A key present here is a
 * local-stack value used only to provision deterministic fixtures and never to
 * assert a result the product reached on its own.
 */
export function localServiceRoleKey(): string | null {
  return readLocalEnv("SUPABASE_SERVICE_ROLE_KEY");
}
