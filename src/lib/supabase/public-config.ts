// Production credentials for the deployed app live in per-environment Vercel
// variables. The hardcoded fallback below keeps preview/production builds
// working until those variables are wired in the Vercel dashboard (see
// .env.example). In local development that fallback is a foot-gun: a missing
// or incomplete .env.local would silently point every request at the
// production Supabase project. Development therefore throws with setup
// instructions instead of falling back.

const productionSupabaseUrl = "https://ievsjfudakeugfalihzq.supabase.co";
const productionPublishableKey =
  "sb_publishable_hMfxFg7BFyTfdWYb6ofFKg_7Fkf1c1d";

const isLocalDevelopment = process.env.NODE_ENV === "development";

function resolvePublicConfig(
  envName: "NEXT_PUBLIC_SUPABASE_URL" | "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
  productionFallback: string
): string {
  const value = process.env[envName];
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
  "NEXT_PUBLIC_SUPABASE_URL",
  productionSupabaseUrl
);

export const publicSupabasePublishableKey = resolvePublicConfig(
  "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
  productionPublishableKey
);