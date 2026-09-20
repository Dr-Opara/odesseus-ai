import { NextResponse } from "next/server";
import { z } from "zod";
import { generateText } from "ai";
import { openai } from "@ai-sdk/openai";
import { startAuthorization } from "@vercel/connect";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { isAdmin } from "@/lib/partners/service";
import { isTrustedOrigin } from "@/lib/security/origin-check";
import {
  createApplicationBrowserSession,
  releaseApplicationBrowserSession,
} from "@/lib/apply/browserbase";
import { getStripe } from "@/lib/stripe";
import { configuredJobSources } from "@/lib/jobs/sources";
import { fetchSourceJobs } from "@/lib/jobs/providers";
import { connectorFor } from "@/lib/integrations/providers";

export const runtime = "nodejs";
export const maxDuration = 60;

const schema = z.object({
  provider: z.enum([
    "supabase",
    "browserbase",
    "openai",
    "stripe",
    "stripe_webhook",
    "job_discovery",
    "cron",
    "google",
    "microsoft",
    "yahoo",
    "google_send",
    "microsoft_send",
    "resend",
  ]),
});

type ConnectorProvider =
  | "google"
  | "microsoft"
  | "yahoo"
  | "google_send"
  | "microsoft_send";

function siteUrl() {
  const value = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  if (!value) throw new Error("NEXT_PUBLIC_SITE_URL is not configured.");
  return value.replace(/\/$/, "");
}

function connectorId(provider: ConnectorProvider) {
  if (provider === "google") return connectorFor("google", "email");
  if (provider === "microsoft") return connectorFor("microsoft", "email");
  if (provider === "yahoo") return connectorFor("yahoo", "email");
  if (provider === "google_send") {
    const value = process.env.ODYSSEUS_CONNECT_GOOGLE_SEND_CONNECTOR?.trim();
    if (!value) throw new Error("Google outbound connector is not configured.");
    return value;
  }

  const value = process.env.ODYSSEUS_CONNECT_MICROSOFT_SEND_CONNECTOR?.trim();
  if (!value) throw new Error("Microsoft outbound connector is not configured.");
  return value;
}

async function testConnector(userId: string, provider: ConnectorProvider) {
  const connector = connectorId(provider);
  const authorization = await startAuthorization(
    connector,
    { subject: { type: "user", id: userId } },
    {
      callbackUrl: `${siteUrl()}/integrations?readiness=${provider}`,
    }
  );

  if (!authorization?.url) {
    throw new Error("Connector did not return an authorization URL.");
  }

  return connector;
}

export async function POST(request: Request) {
  if (!isTrustedOrigin(request)) {
    return NextResponse.json({ error: "Invalid request origin." }, { status: 403 });
  }

  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getClaims();
  const userId = auth?.claims?.sub;

  if (!userId) {
    return NextResponse.json({ error: "Please sign in again." }, { status: 401 });
  }

  if (!(await isAdmin(userId))) {
    return NextResponse.json({ error: "Admin access required." }, { status: 403 });
  }

  let input: z.infer<typeof schema>;
  try {
    input = schema.parse(await request.json());
  } catch {
    return NextResponse.json({ error: "Invalid readiness test." }, { status: 400 });
  }

  const started = Date.now();

  try {
    switch (input.provider) {
      case "supabase": {
        const service = createServiceClient();
        const { count, error } = await service
          .from("profiles")
          .select("id", { count: "exact", head: true });

        if (error) throw error;

        return NextResponse.json({
          ok: true,
          provider: input.provider,
          latencyMs: Date.now() - started,
          detail: `Database reachable · ${count ?? 0} profile row(s)`,
        });
      }

      case "browserbase": {
        const session = await createApplicationBrowserSession({
          runId: "system-readiness",
          userId,
          targetUrl: "about:blank",
        });

        await releaseApplicationBrowserSession(session.id);

        return NextResponse.json({
          ok: true,
          provider: input.provider,
          latencyMs: Date.now() - started,
          detail: "Session created and released successfully.",
        });
      }

      case "openai": {
        const model = process.env.ODYSSEUS_MATCH_MODEL || "gpt-5.6-luna";
        const result = await generateText({
          model: openai(model),
          prompt: "Reply with exactly: OK",
          maxOutputTokens: 8,
          providerOptions: { openai: { store: false } },
        });

        return NextResponse.json({
          ok: result.text.trim().toUpperCase().includes("OK"),
          provider: input.provider,
          latencyMs: Date.now() - started,
          detail: `Model ${model} responded successfully.`,
        });
      }

      case "stripe": {
        const customers = await getStripe().customers.list({ limit: 1 });

        return NextResponse.json({
          ok: Array.isArray(customers.data),
          provider: input.provider,
          latencyMs: Date.now() - started,
          detail: "Stripe API reachable · read-only customer list succeeded.",
        });
      }

      case "stripe_webhook": {
        const secret = process.env.STRIPE_WEBHOOK_SECRET?.trim();
        if (!secret) throw new Error("STRIPE_WEBHOOK_SECRET is not configured.");

        const expectedUrl = `${siteUrl()}/api/webhooks/stripe`;
        const endpoints = await getStripe().webhookEndpoints.list({ limit: 100 });
        const match = endpoints.data.find(
          (endpoint) =>
            endpoint.url.replace(/\/$/, "") === expectedUrl &&
            endpoint.status === "enabled"
        );

        if (!match) {
          throw new Error(
            `No enabled Stripe webhook endpoint matches ${expectedUrl}.`
          );
        }

        return NextResponse.json({
          ok: true,
          provider: input.provider,
          latencyMs: Date.now() - started,
          detail: "Enabled Stripe webhook endpoint found for this site.",
        });
      }

      case "job_discovery": {
        const sources = configuredJobSources();
        if (!sources.length) throw new Error("No job sources are configured.");

        const first = sources[0];
        const jobs = await fetchSourceJobs(first);

        return NextResponse.json({
          ok: true,
          provider: input.provider,
          latencyMs: Date.now() - started,
          detail: `${first.companyName} · ${first.provider} · ${jobs.length} live posting(s)`,
        });
      }

      case "cron": {
        if (!process.env.CRON_SECRET?.trim()) {
          throw new Error("CRON_SECRET is not configured.");
        }
        const sources = configuredJobSources();
        if (!sources.length) {
          throw new Error("Cron secret is configured, but no job sources are configured.");
        }

        return NextResponse.json({
          ok: true,
          provider: input.provider,
          latencyMs: Date.now() - started,
          detail: `Cron authentication is configured · ${sources.length} job source(s) ready for scheduled discovery.`,
        });
      }

      case "google":
      case "microsoft":
      case "yahoo":
      case "google_send":
      case "microsoft_send": {
        const connector = await testConnector(userId, input.provider);
        return NextResponse.json({
          ok: true,
          provider: input.provider,
          latencyMs: Date.now() - started,
          detail: `Connector ${connector} accepted a new authorization request.`,
        });
      }

      case "resend": {
        const apiKey = process.env.RESEND_API_KEY?.trim();
        const from = process.env.ODYSSEUS_PARTNER_FROM_EMAIL?.trim();
        if (!apiKey || !from) {
          throw new Error("Resend API key or Partner sender address is not configured.");
        }

        const response = await fetch("https://api.resend.com/domains?limit=1", {
          headers: {
            authorization: `Bearer ${apiKey}`,
            accept: "application/json",
          },
          cache: "no-store",
          signal: AbortSignal.timeout(15_000),
        });

        if (!response.ok) {
          throw new Error(`Resend returned ${response.status}.`);
        }

        return NextResponse.json({
          ok: true,
          provider: input.provider,
          latencyMs: Date.now() - started,
          detail: `Resend API reachable · sender configured as ${from}.`,
        });
      }
    }
  } catch (error) {
    console.error("[ODYSSEUS_READINESS]", input.provider, error);
    return NextResponse.json(
      {
        ok: false,
        provider: input.provider,
        latencyMs: Date.now() - started,
        detail: error instanceof Error ? error.message : "Readiness check failed.",
      },
      { status: 503 }
    );
  }
}
