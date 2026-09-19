import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { generateInterviewReadiness } from "@/lib/ai/interview-readiness";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getClaims();
  const userId = auth?.claims?.sub;

  if (!userId) {
    return NextResponse.json({ error: "Please sign in again." }, { status: 401 });
  }

  const { data: interview } = await supabase
    .from("interviews")
    .select("*,applications(*)")
    .eq("id", id)
    .eq("user_id", userId)
    .maybeSingle();

  if (!interview?.applications) {
    return NextResponse.json({ error: "Interview context is incomplete." }, { status: 404 });
  }

  const [{ data: timeline }, { data: priorRounds }] = await Promise.all([
    supabase
      .from("application_status_events")
      .select("title,detail,source,occurred_at")
      .eq("user_id", userId)
      .eq("application_id", interview.application_id)
      .order("occurred_at", { ascending: true }),
    supabase
      .from("interview_round_memory")
      .select("round_number,questions_asked,topics_discussed,experiences_used,interviewer_signals,commitments,handoff_summary,created_at")
      .eq("user_id", userId)
      .eq("application_id", interview.application_id)
      .neq("interview_id", id)
      .order("round_number", { ascending: true }),
  ]);

  try {
    const briefing = await generateInterviewReadiness({
      companyName: interview.applications.company_name,
      roleTitle: interview.applications.role_title,
      stage: interview.stage,
      interviewType: interview.interview_type,
      jobSnapshot: interview.applications.job_snapshot,
      resumeSnapshot: interview.applications.resume_snapshot,
      applicationTimeline: timeline || [],
      priorRounds: priorRounds || [],
    });

    const service = createServiceClient();

    const { data: latest } = await service
      .from("interview_readiness")
      .select("version_number")
      .eq("interview_id", id)
      .eq("user_id", userId)
      .order("version_number", { ascending: false })
      .limit(1)
      .maybeSingle();

    const version = (latest?.version_number ?? 0) + 1;
    const now = new Date().toISOString();

    const { data: created, error } = await service
      .from("interview_readiness")
      .insert({
        interview_id: id,
        user_id: userId,
        version_number: version,
        briefing,
      })
      .select("id")
      .single();

    if (error || !created) {
      throw new Error("Odysseus could not save interview readiness.");
    }

    await service
      .from("interviews")
      .update({
        readiness_generated_at: now,
        status:
          ["invited", "scheduled"].includes(interview.status)
            ? "ready"
            : interview.status,
        updated_at: now,
      })
      .eq("id", id)
      .eq("user_id", userId);

    return NextResponse.json({ id: created.id, version });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Odysseus could not prepare this interview.",
      },
      { status: 500 }
    );
  }
}
