// Production credentials for the deployed app live in per-environment Vercel
// variables. The hardcoded fallback below keeps preview/production builds
// working until those variables are wired in the Vercel dashboard (see
// .env.example). In local development that fallback is a foot-gun: a missing
// or incomplete .env.local would silently point every request at the
// production Supabase project. Development therefore throws with setup
// instructions instead of falling back.
//
// This module is imported by browser code, so it must only ever expose
// browser-safe values: the project URL and the *publishable* key. The
// service-role key is server-only and must never be read, referenced, or
// re-exported here.

const productionSupabaseUrl = "https://ievsjfudakeugfalihzq.supabase.co";
const productionPublishableKey =
  "sb_publishable_hMfxFg7BFyTfdWYb6ofFKg_7Fkf1c1d";

const isLocalDevelopment = process.env.NODE_ENV === "development";

// NEXT_PUBLIC_* values are read with static property access (never
// `process.env[envName]` with a variable key): bundlers only statically inline
// `process.env.NEXT_PUBLIC_*` literal member expressions into browser bundles.
// A dynamic indexing lookup survives to the client as an empty `process.env`
// and always reads undefined, which previously made the development guard
// below throw on every client page that imported the Supabase client (e.g.
// /signup). The guard itself stays: local dev still fails loudly instead of
// silently pointing at the production project.
const candidateSupabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const candidatePublishableKey =
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

function resolvePublicConfig(
  value: string | undefined,
  envName: "NEXT_PUBLIC_SUPABASE_URL" | "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
  productionFallback: string
): string {
  if (value) return value;

  if (isLocalDevelopment) {
    throw new Error(
      `${envName} is not set. Local development must target the local Supabase ` +
        `stack: copy .env.example to .env.local and set the local stack values ` +
        `(see \`supabase status\`, kong on 127.0.0.1:54321). Refusing to silently ` +
        `fall back to the production Supabase project.`
    );
  }

  return productionFallback;
}

export const publicSupabaseUrl = resolvePublicConfig(
  candidateSupabaseUrl,
  "NEXT_PUBLIC_SUPABASE_URL",
  productionSupabaseUrl
);

export const publicSupabasePublishableKey = resolvePublicConfig(
  candidatePublishableKey,
  "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
  productionPublishableKey
);
