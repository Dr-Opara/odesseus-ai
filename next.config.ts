import { withWorkflow } from "workflow/next";

const supabaseUrl =
  process.env.NEXT_PUBLIC_SUPABASE_URL ??
  "https://ievsjfudakeugfalihzq.supabase.co";

const supabasePublishableKey =
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
  "sb_publishable_hMfxFg7BFyTfdWYb6ofFKg_7Fkf1c1d";

if (process.env.VERCEL) {
  const required = [
    "NEXT_PUBLIC_SITE_URL",
    "SUPABASE_SERVICE_ROLE_KEY",
    "OPENAI_API_KEY",
    "STRIPE_SECRET_KEY",
    "STRIPE_WEBHOOK_SECRET",
    "BROWSERBASE_API_KEY",
    "BROWSERBASE_PROJECT_ID",
    "VERCEL_CONNECT_GOOGLE_CONNECTOR",
    "VERCEL_CONNECT_MICROSOFT_CONNECTOR",
    "VERCEL_CONNECT_YAHOO_CONNECTOR",
    "CRON_SECRET",
  ];
  const missing = required.filter((key) => !process.env[key]);
  console.log("[ODYSSEUS_CONFIG_AUDIT]", JSON.stringify({
    environment: process.env.VERCEL_ENV ?? "unknown",
    missing,
  }));
}

export default withWorkflow({
  env: {
    NEXT_PUBLIC_SUPABASE_URL: supabaseUrl,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: supabasePublishableKey,
  },
});
