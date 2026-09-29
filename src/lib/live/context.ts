import { createServiceClient } from "@/lib/supabase/service";

export async function buildLiveContext(userId: string, interviewId: string) {
  const service = createServiceClient();

  const { data: interview } = await service
    .from("interviews")
    .select("*,applications(*)")
    .eq("id", interviewId)
    .eq("user_id", userId)
    .maybeSingle();

  if (!interview?.applications) {
    throw new Error("Interview context is incomplete.");
  }

  // Manual interviews have no linked application; Live context requires one.
  const applicationId = interview.application_id;
  if (!applicationId) {
    throw new Error("Interview context is incomplete.");
  }

  const [
    { data: readiness },
    { data: priorRounds },
    { data: profile },
  ] = await Promise.all([
    service
      .from("interview_readiness")
      .select("briefing,version_number")
      .eq("interview_id", interviewId)
      .eq("user_id", userId)
      .order("version_number", { ascending: false })
      .limit(1)
      .maybeSingle(),
    service
      .from("interview_round_memory")
      .select("round_number,questions_asked,topics_discussed,experiences_used,commitments,handoff_summary")
      .eq("application_id", applicationId)
      .eq("user_id", userId)
      .neq("interview_id", interviewId)
      .order("round_number", { ascending: true }),
    service
      .from("profiles")
      .select("full_name")
      .eq("id", userId)
      .maybeSingle(),
  ]);

  return {
    interview: {
      id: interview.id,
      stage: interview.stage,
      interviewType: interview.interview_type,
      responseStyle: interview.response_style || "conversational",
      responseLength: interview.response_length || "30_45",
      roundNumber: interview.round_number,
      interviewerDetails: interview.interviewer_details,
    },
    application: {
      id: interview.applications.id,
      companyName: interview.applications.company_name,
      roleTitle: interview.applications.role_title,
      jobSnapshot: interview.applications.job_snapshot,
      resumeSnapshot: interview.applications.resume_snapshot,
    },
    candidate: {
      fullName: profile?.full_name || null,
    },
    readiness: readiness?.briefing || null,
    priorRounds: priorRounds || [],
  };
}
