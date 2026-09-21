import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { runAutomaticJobDiscovery } from "@/lib/jobs/discovery";
import { checkRateLimit } from "@/lib/security/rate-limit";
import { integrationNotConfigured, missingEnv } from "@/lib/config/readiness";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST() {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getClaims();
  const userId = auth?.claims?.sub;

  if (!userId) {
    return NextResponse.json({ error: "Please sign in again." }, { status: 401 });
  }

  const rateLimit = checkRateLimit(`jobs-discover:user:${userId}`, 6, 60 * 60 * 1000);
  if (!rateLimit.allowed) {
    return NextResponse.json(
      { error: "You've refreshed matches recently. Please wait a bit and try again." },
      { status: 429 }
    );
  }

  const missing = missingEnv(["SUPABASE_SERVICE_ROLE_KEY", "OPENAI_API_KEY"] as const);
  if (missing.length) {
    console.error("[ODESSEUS_JOB_DISCOVERY] missing configuration", missing);
    return NextResponse.json(
      integrationNotConfigured("Job discovery", missing),
      { status: 503 }
    );
  }

  try {
    const result = await runAutomaticJobDiscovery({ userIds: [userId] });
    return NextResponse.json(result);
  } catch (error) {
    console.error("[ODESSEUS_JOB_DISCOVERY] manual discovery failed", error);
    return NextResponse.json(
      { error: "Odesseus could not refresh job matches." },
      { status: 500 }
    );
  }
}
