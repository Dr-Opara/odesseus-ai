import { NextResponse } from "next/server";
import { z } from "zod";
import { generateText } from "ai";
import { openai } from "@ai-sdk/openai";
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

export const runtime = "nodejs";
export const maxDuration = 60;

const schema = z.object({
  provider: z.enum(["supabase", "browserbase", "openai", "stripe", "job_discovery"]),
});

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
        const account = await getStripe().accounts.retrieve();

        return NextResponse.json({
          ok: Boolean(account.id),
          provider: input.provider,
          latencyMs: Date.now() - started,
          detail: `Stripe account reachable · ${account.charges_enabled ? "charges enabled" : "charges not enabled"}`,
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
