import { createServiceClient } from "@/lib/supabase/service";
import type { Database } from "@/types/database";

export type InterviewWorkspaceContext = {
  interview: {
    id: string;
    stage: string | null;
    interviewType: string | null;
    responseStyle: string | null;
    responseLength: string | null;
    roundNumber: number | null;
    interviewerDetails: unknown;
    company: string | null;
    location: string | null;
    meetingType: string | null;
    notes: string | null;
    applicationUrl: string | null;
    source: string | null;
    status: string;
    scheduledAt: string | null;
    timezone: string | null;
    durationMinutes: number | null;
    readinessGeneratedAt: string | null;
  };
  application: {
    id: string | null;
    companyName: string | null;
    roleTitle: string | null;
    jobSnapshot: Database["public"]["Tables"]["applications"]["Row"]["job_snapshot"] | null;
    executionMode: Database["public"]["Tables"]["applications"]["Row"]["execution_mode"] | null;
    matchScoreSnapshot: Database["public"]["Tables"]["applications"]["Row"]["match_score_snapshot"] | null;
    answersSnapshot: Database["public"]["Tables"]["applications"]["Row"]["answers_snapshot"] | null;
    resumeSnapshot: Database["public"]["Tables"]["applications"]["Row"]["resume_snapshot"] | null;
  };
  candidate: {
    fullName: string | null;
  };
  readiness: {
    version: number | null;
    generatedAt: string | null;
    briefing: unknown;
    // Prep modules generated from the briefing (all optional for backward compat)
    likelyQuestions: string[] | null;
    behavioralQuestions: Array<{ question: string; focus: string }> | null;
    starPrompts: Array<{ prompt: string; exampleLabel: string | null; sourceEvidence: string[] }> | null;
    technicalConceptQuestions: Array<{ concept: string; question: string; why: string }> | null;
    companySpecific: Array<{ area: string; preparation: string; verifiedEvidence: string[] }> | null;
    questionsToAskInterviewer: string[] | null;
    prepSummary: string | null;
  };
  priorRounds: Array<{
    roundNumber: number;
    questionsAsked: string[];
    topicsDiscussed: string[];
    experiencesUsed: string[];
    commitments: string[];
    handoffSummary: string | null;
    createdAt: string;
  }>;
  mockSessionsReady: boolean;
  entitlement: {
    hasAccess: boolean;
    source: string | null;
    plan: string | null;
    sessionsRemaining: number;
    unlimitedUntil: string | null;
  };
};

type PrepModules = Pick<
  InterviewWorkspaceContext["readiness"],
  | "likelyQuestions"
  | "behavioralQuestions"
  | "starPrompts"
  | "technicalConceptQuestions"
  | "companySpecific"
  | "questionsToAskInterviewer"
  | "prepSummary"
>;

const EMPTY_PREP_MODULES: PrepModules = {
  likelyQuestions: null,
  behavioralQuestions: null,
  starPrompts: null,
  technicalConceptQuestions: null,
  companySpecific: null,
  questionsToAskInterviewer: null,
  prepSummary: null,
};

function parsePrepModules(briefing: unknown): PrepModules {
  if (!briefing || typeof briefing !== "object") return EMPTY_PREP_MODULES;
  const b = briefing as Record<string, unknown>;
  return {
    likelyQuestions: Array.isArray(b.likelyQuestions) ? (b.likelyQuestions as string[]) : null,
    behavioralQuestions: Array.isArray(b.behavioralQuestions)
      ? (b.behavioralQuestions as PrepModules["behavioralQuestions"])
      : null,
    starPrompts: Array.isArray(b.starPrompts) ? (b.starPrompts as PrepModules["starPrompts"]) : null,
    technicalConceptQuestions: Array.isArray(b.technicalConceptQuestions)
      ? (b.technicalConceptQuestions as PrepModules["technicalConceptQuestions"])
      : null,
    companySpecific: Array.isArray(b.companySpecific)
      ? (b.companySpecific as PrepModules["companySpecific"])
      : null,
    questionsToAskInterviewer: Array.isArray(b.questionsToAskInterviewer)
      ? (b.questionsToAskInterviewer as string[])
      : null,
    prepSummary: typeof b.prepSummary === "string" ? b.prepSummary : null,
  };
}

async function buildInterviewContext(
  userId: string,
  interviewId: string
): Promise<InterviewWorkspaceContext> {
  const service = createServiceClient();

  // 1. Interview + applications (may be null for manual interviews)
  const { data: interview, error: interviewError } = await service
    .from("interviews")
    .select(
      `
      *,
      applications(*)
    `
    )
    .eq("id", interviewId)
    .eq("user_id", userId)
    .maybeSingle();

  if (interviewError) {
    throw new Error(`Failed to load interview: ${interviewError.message}`);
  }

  if (!interview) {
    throw new Error("Interview not found.");
  }

  // 2. Readiness (latest version)
  const [{ data: readiness }, { data: profile }] = await Promise.all([
    service
      .from("interview_readiness")
      .select("id, version_number, briefing, created_at")
      .eq("interview_id", interviewId)
      .eq("user_id", userId)
      .order("version_number", { ascending: false })
      .limit(1)
      .maybeSingle(),
    service
      .from("profiles")
      .select("full_name")
      .eq("id", userId)
      .maybeSingle(),
  ]);

  // 3. Prior rounds (by application_id, excluding current interview).
  // Manual interviews have no application_id, so there are no prior rounds.
  const priorRounds = interview.application_id
    ? (
        await service
          .from("interview_round_memory")
          .select(
            "round_number, questions_asked, topics_discussed, experiences_used, commitments, handoff_summary, created_at"
          )
          .eq("application_id", interview.application_id)
          .eq("user_id", userId)
          .neq("interview_id", interviewId)
          .order("round_number", { ascending: true })
      ).data ?? []
    : [];

  // 4. Entitlement (basic state - full entitlement check via readLiveEntitlement
  // can be added in a follow-up once RPC types are fully aligned)
  const entitlement = {
    hasAccess: false,
    source: "none",
    plan: null,
    sessionsRemaining: 0,
    unlimitedUntil: null,
  };

  // Build the context object
  const application = interview.applications
    ? {
        id: interview.applications.id,
        companyName: interview.applications.company_name,
        roleTitle: interview.applications.role_title,
        jobSnapshot: interview.applications.job_snapshot,
        executionMode: interview.applications.execution_mode,
        matchScoreSnapshot: interview.applications.match_score_snapshot,
        answersSnapshot: interview.applications.answers_snapshot,
        resumeSnapshot: interview.applications.resume_snapshot,
      }
    : {
        id: null,
        companyName: interview.company,
        roleTitle: interview.role_title,
        jobSnapshot: null,
        executionMode: null,
        matchScoreSnapshot: null,
        answersSnapshot: null,
        resumeSnapshot: null,
      };

  // Parse prep modules from readiness briefing (optional, backward-compatible)
  const briefing: unknown = readiness?.briefing ?? null;
  const prepModules = parsePrepModules(briefing);

  return {
    interview: {
      id: interview.id,
      stage: interview.stage,
      interviewType: interview.interview_type,
      responseStyle: interview.response_style || "conversational",
      responseLength: interview.response_length || "30_45",
      roundNumber: interview.round_number,
      interviewerDetails: interview.interviewer_details,
      company: interview.company,
      location: interview.location,
      meetingType: interview.meeting_type,
      notes: interview.notes,
      applicationUrl: interview.application_url,
      source: interview.source,
      status: interview.status,
      scheduledAt: interview.scheduled_at,
      timezone: interview.timezone,
      durationMinutes: interview.duration_minutes,
      readinessGeneratedAt: interview.readiness_generated_at,
    },
    application,
    candidate: {
      fullName: profile?.full_name || null,
    },
    readiness: {
      version: readiness?.version_number ?? null,
      generatedAt: readiness?.created_at ?? null,
      briefing,
      ...prepModules,
    },
    priorRounds: priorRounds.map((r) => ({
      roundNumber: r.round_number,
      questionsAsked: r.questions_asked ?? [],
      topicsDiscussed: r.topics_discussed ?? [],
      experiencesUsed: r.experiences_used ?? [],
      commitments: r.commitments ?? [],
      handoffSummary:
        typeof r.handoff_summary === "string" ? r.handoff_summary : null,
      createdAt: r.created_at,
    })),
    mockSessionsReady: false,
    entitlement,
  };
}

export { buildInterviewContext };
