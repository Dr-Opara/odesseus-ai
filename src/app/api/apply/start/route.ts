import { NextResponse } from "next/server";
import { z } from "zod";
import { start } from "workflow/api";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { applicationWorkflow } from "@/workflows/application";
import { isSafeExternalUrl } from "@/lib/security/url-safety";
import { isTrustedOrigin } from "@/lib/security/origin-check";
import { integrationNotConfigured, missingEnv } from "@/lib/config/readiness";

const schema = z.object({
  jobId: z.string().uuid(),
  targetUrl: z.string().url(),\n  mode: z.enum(["apply", "smart_apply"]),
});

export async function POST(request: Request) {
  if (!isTrustedOrigin(request)) {
    return NextResponse.json({ error: "Request origin could not be verified." }, { status: 403 });
  }

  const missing = missingEnv([
    "SUPABASE_SERVICE_ROLE_KEY",
    "BROWSERBASE_API_KEY",
    "BROWSERBASE_PROJECT_ID",
  ] as const);
  if (missing.length) {
    console.error("[ODESSEUS_APPLY] missing configuration", missing);
    return NextResponse.json(
      integrationNotConfigured("Apply", missing),
      { status: 503 }
    );
  }

  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getClaims();
  const userId = auth?.claims?.sub;

  if (!userId) {
    return NextResponse.json({ error: "Please sign in again." }, { status: 401 });
  }

  let input: z.infer<typeof schema>;
  try {
    input = schema.parse(await request.json());
  } catch {
    return NextResponse.json({ error: "Enter a valid application URL." }, { status: 400 });
  }

  const urlCheck = await isSafeExternalUrl(input.targetUrl);
  if (!urlCheck.safe) {
    return NextResponse.json({ error: "Odesseus only opens secure, public application pages." }, { status: 400 });
  }

  const [{ data: job }, { data: wallet }, { data: credits }, { data: tailoring }, { data: masterResume }, { data: activeRun }] = await Promise.all([
    supabase
      .from("job_opportunities")
      .select("id,company_name,role_title,status")
      .eq("id", input.jobId)
      .eq("user_id", userId)
      .maybeSingle(),
    supabase
      .from("credit_balances")
      .select("application_credits")
      .eq("user_id", userId)
      .maybeSingle(),
    supabase
      .from("resume_tailorings")
      .select("id,approved_resume_id,status,version_number")
      .eq("job_id", input.jobId)
      .eq("user_id", userId)
      .eq("status", "approved")
      .order("version_number", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from("application_runs")
      .select("id,status")
      .eq("user_id", userId)
      .in("status", ["queued","preflight","running","needs_user","ready_to_submit","submitting"])
      .maybeSingle(),
  ]);

  if (!job) {
    return NextResponse.json({ error: "Job not found." }, { status: 404 });
  }

  if (!tailoring?.approved_resume_id) {
    return NextResponse.json({ error: "Approve a tailored resume before starting Apply." }, { status: 400 });
  }

  if ((credits?.application_credits ?? 0) < 1) {
    return NextResponse.json({ error: "You need at least one application credit." }, { status: 402 });
  }

  if (activeRun) {
    return NextResponse.json(
      { error: "Finish or cancel your current application before starting another.", runId: activeRun.id },
      { status: 409 }
    );
  }

  const service = createServiceClient();
  const { data: run, error: runError } = await service
    .from("application_runs")
    .insert({
      user_id: userId,
      job_id: job.id,
      approved_resume_id: resumeId,\n      application_mode: input.mode,\n      price_cents: priceCents,\n      payment_source: paymentSource,
      target_url: input.targetUrl,
      execution_mode: "assisted",
      status: "queued",
    })
    .select("id")
    .single();

  if (runError || !run) {
    return NextResponse.json({ error: "Odesseus could not create the application run." }, { status: 500 });
  }

  await service.from("application_run_events").insert({
    run_id: run.id,
    user_id: userId,
    event_type: "created",
    summary: "Application run created.",
    metadata: { target_url: input.targetUrl },
  });

  try {
    const workflowRun = await start(applicationWorkflow, [run.id]);

    await service
      .from("application_runs")
      .update({
        workflow_run_id: workflowRun.runId,
        status: "preflight",
        updated_at: new Date().toISOString(),
      })
      .eq("id", run.id);

    return NextResponse.json({ runId: run.id });
  } catch (error) {
    console.error("Odesseus Apply could not start:", error);

    await service
      .from("application_runs")
      .update({
        status: "failed",
        stop_reason: "Odesseus could not start the application workflow.",
        finished_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", run.id);

    return NextResponse.json(
      { error: "Odesseus could not start Apply." },
      { status: 500 }
    );
  }
}
