export const publicSupabaseUrl =
  process.env.NEXT_PUBLIC_SUPABASE_URL ||
  "https://ievsjfudakeugfalihzq.supabase.co";

export const publicSupabasePublishableKey =
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
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