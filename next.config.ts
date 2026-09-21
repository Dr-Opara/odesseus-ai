import { withWorkflow } from "workflow/next";

// `||` (not `??`) is deliberate: an env var configured as an empty string
// must fall back the same as an unset one, or a blank NEXT_PUBLIC_SUPABASE_URL
// silently produces an empty Supabase client URL app-wide (see the incident
// where this var existed in Vercel but was set to "").
const supabaseUrl =
  process.env.NEXT_PUBLIC_SUPABASE_URL ||
  "https://ievsjfudakeugfalihzq.supabase.co";

const supabasePublishableKey =
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
  "sb_publishable_hMfxFg7BFyTfdWYb6ofFKg_7Fkf1c1d";

if (process.env.VERCEL && process.env.VERCEL_ENV !== "production") {
  const required = [
    "NEXT_PUBLIC_SITE_URL",
    "SUPABASE_SERVICE_ROLE_KEY",
    "OPENAI_API_KEY",
    "STRIPE_SECRET_KEY",
    "STRIPE_WEBHOOK_SECRET",
    "BROWSERBASE_API_KEY",
    "BROWSERBASE_PROJECT_ID",
    "ODESSEUS_CONNECT_GOOGLE_CONNECTOR",
    "ODESSEUS_CONNECT_YAHOO_CONNECTOR",
    "CRON_SECRET",
  ];
  const missing = required.filter((key) => !process.env[key]);
  console.log("[ODESSEUS_CONFIG_AUDIT]", JSON.stringify({
    environment: process.env.VERCEL_ENV ?? "unknown",
    missing,
  }));
}

const supabaseHost = (() => {
  try {
    return new URL(supabaseUrl).host;
  } catch {
    return "";
  }
})();

const connectSrc = [
  "'self'",
  supabaseHost ? `https://${supabaseHost}` : "",
  supabaseHost ? `wss://${supabaseHost}` : "",
  "https://api.openai.com",
  "wss://api.openai.com",
]
  .filter(Boolean)
  .join(" ");

const csp = [
  "default-src 'self'",
  `connect-src ${connectSrc}`,
  // React's style={{...}} props render as inline style attributes; Next.js
  // hydration also emits an inline bootstrap script — both need
  // 'unsafe-inline' without a nonce-based CSP, which this middleware-free
  // config does not implement. Documented residual risk (see AGENTS.md).
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: https:",
  "font-src 'self' data:",
  "media-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: csp },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // Live needs microphone + display-media (for shared interview audio)
  // capture from the same origin; everything else stays denied.
  { key: "Permissions-Policy", value: "microphone=(self), display-capture=(self), camera=(), geolocation=(), payment=()" },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
];

export default withWorkflow({
  env: {
    NEXT_PUBLIC_SUPABASE_URL: supabaseUrl,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: supabasePublishableKey,
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: securityHeaders,
      },
    ];
  },
});
