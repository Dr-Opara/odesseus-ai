import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { generatePostInterviewAnalysis } from "@/lib/ai/post-interview";
import { postInterviewAnalysisSchema } from "@/lib/ai/schemas";
import { loadGuestAccess } from "@/lib/interviews/guest-share";

export const runtime = "nodejs";

/**
 * Read the guest's own post-interview analysis.
 *
 * The POST below generates and stores an analysis, but the guest could not read
 * it back: the applicant analysis page reads the row straight from
 * `post_interview_analyses` under the owner's session, which a guest does not
 * have. Without this a guest could generate an analysis and never see it.
 *
 * The scope is the same as the POST and no wider. The interview id is not
 * taken from the request -- it is `record.interview_id`, the single interview
 * this token resolved to. One token reaches one guest record, which reaches
 * one interview, so a guest cannot name another interview and the response is
 * limited to the newest version of that one.
 *
 * The analysis is parsed through the same `postInterviewAnalysisSchema` the
 * applicant page uses, so a stored row that no longer satisfies the schema
 * renders as absent rather than half-populated. The follow-up draft comes back
 * with no recipient address, because a guest never had one.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;
  const service = createServiceClient();

  const access = await loadGuestAccess(service, token);
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status });
  }

  const { record } = access;

  const empty = {
    ok: true as const,
    analysis: null,
    followUp: null,
    transcriptItemCount: 0,
    versionNumber: null,
    guestName: record.guest_name,
    company: record.guest_company,
    roleTitle: record.guest_role_title,
  };

  if (!record.interview_id) return NextResponse.json(empty);

  const { data: analysisRow } = await service
    .from("post_interview_analyses")
    .select("id,version_number,analysis,transcript_item_count")
    .eq("interview_id", record.interview_id)
    .eq("user_id", record.owner_user_id)
    .order("version_number", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!analysisRow) return NextResponse.json(empty);

  const parsed = postInterviewAnalysisSchema.safeParse(analysisRow.analysis);

  const { data: followUp } = await service
    .from("follow_up_drafts")
    .select("id,subject,body,status")
    .eq("analysis_id", analysisRow.id)
    .eq("user_id", record.owner_user_id)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  return NextResponse.json({
    ok: true as const,
    analysis: parsed.success ? parsed.data : null,
    versionNumber: analysisRow.version_number,
    transcriptItemCount: analysisRow.transcript_item_count ?? 0,
    followUp: followUp
      ? {
          id: followUp.id,
          subject: followUp.subject,
          body: followUp.body,
          status: followUp.status,
        }
      : null,
    guestName: record.guest_name,
    company: record.guest_company,
    roleTitle: record.guest_role_title,
  });
}

/**
 * Guest post-interview analysis. Reuses the existing analysis generator and
 * the same post_interview_analyses / follow_up_drafts tables, but every
 * input is guest-sourced: the guest's company/role, job description, and
 * resume. Nothing applicant-owned is read or written. There is no prior
 * round memory for a guest and no interviewer details.
 */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;
  const service = createServiceClient();

  const access = await loadGuestAccess(service, token);
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status });
  }

  const { record } = access;
  if (!record.live_session_id || !record.interview_id) {
    return NextResponse.json(
      { error: "There is no guest session to analyze." },
      { status: 409 }
    );
  }

  const [
    { data: liveSession },
    { data: transcriptItems },
    { data: guidanceItems },
    { data: latestAnalysis },
  ] = await Promise.all([
    service
      .from("live_interview_sessions")
      .select("id,status")
      .eq("id", record.live_session_id)
      .eq("user_id", record.owner_user_id)
      .maybeSingle(),
    service
      .from("live_transcript_items")
      .select("transcript,is_question,question_text,occurred_at")
      .eq("session_id", record.live_session_id)
      .eq("user_id", record.owner_user_id)
      .order("occurred_at", { ascending: true }),
    service
      .from("live_guidance")
      .select("question_text,response_text,verified_evidence,caution,created_at")
      .eq("session_id", record.live_session_id)
      .eq("user_id", record.owner_user_id)
      .order("created_at", { ascending: true }),
    service
      .from("post_interview_analyses")
      .select("version_number")
      .eq("interview_id", record.interview_id)
      .eq("user_id", record.owner_user_id)
      .order("version_number", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  if (!liveSession || (liveSession.status !== "ended" && liveSession.status !== "completed")) {
    return NextResponse.json(
      { error: "End the guest session before generating its analysis." },
      { status: 409 }
    );
  }

  if (!transcriptItems?.length) {
    return NextResponse.json(
      { error: "No Live transcript is available for this guest session." },
      { status: 400 }
    );
  }

  try {
    const analysis = await generatePostInterviewAnalysis({
      companyName: record.guest_company || "the employer",
      roleTitle: record.guest_role_title || "the role",
      stage: null,
      jobSnapshot: record.guest_job_description
        ? { description: record.guest_job_description }
        : null,
      resumeSnapshot: record.guest_resume_profile ?? record.guest_resume_text ?? null,
      transcriptItems,
      guidanceItems: guidanceItems || [],
      priorRoundMemory: [],
      interviewerDetails: null,
    });

    const versionNumber = (latestAnalysis?.version_number ?? 0) + 1;

    const { data: savedAnalysis, error: analysisError } = await service
      .from("post_interview_analyses")
      .insert({
        interview_id: record.interview_id,
        application_id: null,
        user_id: record.owner_user_id,
        version_number: versionNumber,
        analysis,
        transcript_item_count: transcriptItems.length,
      })
      .select("id")
      .single();

    if (analysisError || !savedAnalysis) {
      throw new Error("Odesseus could not save the analysis.");
    }

    const { data: followUp, error: followUpError } = await service
      .from("follow_up_drafts")
      .insert({
        interview_id: record.interview_id,
        application_id: null,
        user_id: record.owner_user_id,
        analysis_id: savedAnalysis.id,
        recipient_email: null,
        recipient_name: record.guest_name,
        subject: analysis.followUpDraft.subject,
        body: analysis.followUpDraft.body,
        status: "draft",
      })
      .select("id")
      .single();

    if (followUpError || !followUp) {
      throw new Error("Odesseus could not save the follow-up draft.");
    }

    return NextResponse.json({
      ok: true,
      analysisId: savedAnalysis.id,
      followUpId: followUp.id,
      versionNumber,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Odesseus could not analyze this guest session.",
      },
      { status: 500 }
    );
  }
}
