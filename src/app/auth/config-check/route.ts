import { NextResponse } from "next/server";

export const runtime = "nodejs";

const required = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
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
] as const;

const optional = [
  "VERCEL_CONNECT_GOOGLE_SEND_CONNECTOR",
  "VERCEL_CONNECT_MICROSOFT_SEND_CONNECTOR",
] as const;

export async function GET() {
  const configured = Object.fromEntries(
    required.map((key) => [key, Boolean(process.env[key])])
  );
  const optionalConfigured = Object.fromEntries(
    optional.map((key) => [key, Boolean(process.env[key])])
  );
  const missing = required.filter((key) => !process.env[key]);

  return NextResponse.json({
    ok: missing.length === 0,
    environment: process.env.VERCEL_ENV ?? "unknown",
    configured,
    optionalConfigured,
    missing,
  });
}
