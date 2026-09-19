import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import InterviewSettingsForm from "@/components/interview-settings-form";
import ReadinessButton from "@/components/readiness-button";
import RoundMemoryForm from "@/components/round-memory-form";
import { interviewReadinessSchema, type RoundHandoff } from "@/lib/ai/schemas";
import type {
  InterviewerDetails,
  JobSnapshot,
  ResumeSnapshot,
} from "@/types/json-fields";

export default async function InterviewWorkspacePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getClaims();
  const userId = auth?.claims?.sub;

  if (!userId) redirect("/login");

  const { data: interview } = await supabase
    .from("interviews")
    .select("*,applications(*)")
    .eq("id", id)
    .eq("user_id", userId)
    .maybeSingle();

  if (!interview?.applications) notFound();

  const application = interview.applications;

  const [
    { data: readiness },
    { data: timeline },
    { data: currentMemory },
    { data: allRoundMemory },
    { data: liveSession },
    { data: postAnalysis },
  ] = await Promise.all([
    supabase
      .from("interview_readiness")
      .select("id,version_number,briefing,created_at")
      .eq("interview_id", id)
      .eq("user_id", userId)
      .order("version_number", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from("application_status_events")
      .select("id,title,detail,source,occurred_at")
      .eq("application_id", interview.application_id)
      .eq("user_id", userId)
      .order("occurred_at", { ascending: false })
      .limit(8),
    supabase
      .from("interview_round_memory")
      .select("*")
      .eq("interview_id", id)
      .eq("user_id", userId)
      .maybeSingle(),
    supabase
      .from("interview_round_memory")
      .select("id,interview_id,round_number,questions_asked,topics_discussed,experiences_used,commitments,handoff_summary,created_at")
      .eq("application_id", interview.application_id)
      .eq("user_id", userId)
      .order("round_number", { ascending: true }),
    supabase
      .from("live_interview_sessions")
      .select("id,status,ended_at")
      .eq("interview_id", id)
      .eq("user_id", userId)
      .maybeSingle(),
    supabase
      .from("post_interview_analyses")
      .select("id,version_number")
      .eq("interview_id", id)
      .eq("user_id", userId)
      .order("version_number", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  const parsedReadiness = readiness
    ? interviewReadinessSchema.safeParse(readiness.briefing)
    : null;

  const briefing =
    parsedReadiness?.success ? parsedReadiness.data : null;

  const resumeSnapshot = application.resume_snapshot as ResumeSnapshot;
  const jobSnapshot = application.job_snapshot as JobSnapshot;
  const interviewerDetails = interview.interviewer_details as InterviewerDetails;

  const resumePath = resumeSnapshot?.storage_path || null;

  let resumeUrl: string | null = null;

  if (resumePath) {
    const { data } = await supabase.storage
      .from("resumes")
      .createSignedUrl(resumePath, 900);

    resumeUrl = data?.signedUrl || null;
  }

  const jobDescription =
    jobSnapshot?.description ||
    "The original job description was not captured.";

  const interviewer =
    interviewerDetails?.name ||
    interviewerDetails?.email ||
    "Not provided";

  return (
    <main className="shell" style={{ padding: "54px 0 100px" }}>
      <Link href="/interviews" className="muted" style={{ fontSize: 14 }}>
        ← Interviews
      </Link>

      <div className="interview-workspace-heading">
        <div>
          <div className="badge">
            {interview.stage || "Interview"}
          </div>
          <h1
            style={{
              fontSize: 46,
              letterSpacing: "-0.05em",
              margin: "14px 0 7px",
            }}
          >
            {application.role_title}
          </h1>
          <p className="muted" style={{ fontSize: 18, margin: 0 }}>
            {application.company_name}
          </p>
        </div>

        <ReadinessButton
          interviewId={interview.id}
          hasReadiness={Boolean(briefing)}
        />
      </div>

      <div className="interview-facts-grid">
        <div className="card interview-fact">
          <span className="muted">When</span>
          <strong>
            {interview.scheduled_at
              ? new Date(interview.scheduled_at).toLocaleString()
              : "Time pending"}
          </strong>
        </div>

        <div className="card interview-fact">
          <span className="muted">Platform</span>
          <strong>{interview.meeting_provider || "Not provided"}</strong>
        </div>

        <div className="card interview-fact">
          <span className="muted">Interviewer</span>
          <strong>{interviewer}</strong>
        </div>

        <div className="card interview-fact">
          <span className="muted">Duration</span>
          <strong>
            {interview.duration_minutes
              ? `${interview.duration_minutes} min`
              : "Not set"}
          </strong>
        </div>
      </div>

      {interview.meeting_url ? (
        <div style={{ marginTop: 14 }}>
          <a
            className="btn btn-secondary"
            href={interview.meeting_url}
            target="_blank"
            rel="noreferrer"
          >
            Open meeting link
          </a>
        </div>
      ) : null}

      <div className="interview-workspace-grid">
        <section>
          {briefing ? (
            <>
              <div className="card interview-brief-card">
                <div className="muted" style={{ fontSize: 13 }}>
                  Readiness brief
                </div>
                <h2 style={{ fontSize: 28, margin: "8px 0 10px" }}>
                  {briefing.interviewGoal}
                </h2>
                <p className="muted" style={{ lineHeight: 1.65, margin: 0 }}>
                  {briefing.executiveBrief}
                </p>
              </div>

              <div className="card interview-section-card">
                <div className="muted" style={{ fontSize: 13 }}>
                  Focus areas
                </div>
                <div className="interview-focus-list">
                  {briefing.focusAreas.map((item) => (
                    <div key={item.topic} className="interview-focus-item">
                      <strong>{item.topic}</strong>
                      <p className="muted">{item.whyItMatters}</p>
                      {item.verifiedEvidence.length ? (
                        <div className="interview-evidence">
                          {item.verifiedEvidence.map((evidence) => (
                            <span key={evidence}>✓ {evidence}</span>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  ))}
                </div>
              </div>

              <div className="card interview-section-card">
                <div className="muted" style={{ fontSize: 13 }}>
                  Experience examples
                </div>
                <div className="interview-example-list">
                  {briefing.experienceExamples.map((example) => (
                    <div key={example.label} className="interview-example">
                      <strong>{example.label}</strong>
                      <div><span className="muted">Situation:</span> {example.situation}</div>
                      <div><span className="muted">Action:</span> {example.action}</div>
                      {example.result ? (
                        <div><span className="muted">Result:</span> {example.result}</div>
                      ) : null}
                    </div>
                  ))}
                </div>
              </div>

              <div className="interview-two-column">
                <div className="card interview-section-card">
                  <div className="muted" style={{ fontSize: 13 }}>
                    Likely topic areas
                  </div>
                  <div className="interview-simple-list">
                    {briefing.likelyTopicAreas.map((item) => (
                      <div key={item.topic}>
                        <strong>{item.topic}</strong>
                        <span className="muted">{item.rationale}</span>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="card interview-section-card">
                  <div className="muted" style={{ fontSize: 13 }}>
                    Questions to ask
                  </div>
                  <div className="interview-simple-list">
                    {briefing.questionsToAsk.map((question) => (
                      <div key={question}>{question}</div>
                    ))}
                  </div>
                </div>
              </div>

              {briefing.gapsToHandleHonestly.length ? (
                <div className="card interview-section-card">
                  <div className="muted" style={{ fontSize: 13 }}>
                    Gaps to handle honestly
                  </div>
                  <div className="interview-simple-list">
                    {briefing.gapsToHandleHonestly.map((item) => (
                      <div key={item.gap}>
                        <strong>{item.gap}</strong>
                        <span className="muted">{item.approach}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}
            </>
          ) : (
            <div className="card interview-empty-readiness">
              <div className="badge">Ready to prepare</div>
              <h2 style={{ fontSize: 30, margin: "16px 0 8px" }}>
                Build your interview brief.
              </h2>
              <p className="muted" style={{ lineHeight: 1.6, margin: 0 }}>
                Odysseus will use only the exact job, submitted resume, and application history for this interview.
              </p>
            </div>
          )}

          {allRoundMemory?.length ? (
            <div className="card interview-section-card">
              <div className="muted" style={{ fontSize: 13 }}>
                Multi-round memory
              </div>
              <h2 style={{ fontSize: 22, margin: "7px 0 8px" }}>
                What prior rounds already covered
              </h2>
              <div className="round-history-list">
                {allRoundMemory
                  .filter((memory) => memory.interview_id !== id)
                  .map((memory) => {
                    const handoffSummary =
                      memory.handoff_summary as RoundHandoff | null;

                    return (
                    <div className="round-history-item" key={memory.id}>
                      <div className="round-history-heading">
                        <strong>Round {memory.round_number}</strong>
                        <span className="muted">
                          {new Date(memory.created_at).toLocaleDateString()}
                        </span>
                      </div>

                      {handoffSummary?.summary ? (
                        <p className="muted" style={{ lineHeight: 1.55 }}>
                          {handoffSummary.summary}
                        </p>
                      ) : null}

                      {handoffSummary?.buildOn?.length ? (
                        <div className="round-memory-mini">
                          <span className="muted">Build on</span>
                          {handoffSummary.buildOn.map((item: string) => (
                            <div key={item}>• {item}</div>
                          ))}
                        </div>
                      ) : null}

                      {handoffSummary?.openThreads?.length ? (
                        <div className="round-memory-mini">
                          <span className="muted">Open threads</span>
                          {handoffSummary.openThreads.map((item: string) => (
                            <div key={item}>• {item}</div>
                          ))}
                        </div>
                      ) : null}
                    </div>
                    );
                  })}
              </div>
            </div>
          ) : null}

          <RoundMemoryForm
            interviewId={interview.id}
            initial={
              currentMemory
                ? {
                    questions_asked: currentMemory.questions_asked,
                    topics_discussed: currentMemory.topics_discussed,
                    experiences_used: currentMemory.experiences_used,
                    interviewer_signals: currentMemory.interviewer_signals,
                    commitments: currentMemory.commitments,
                    candidate_notes: currentMemory.candidate_notes,
                  }
                : null
            }
          />

          <div className="card interview-section-card">
            <div className="muted" style={{ fontSize: 13 }}>
              Application context
            </div>
            <h2 style={{ fontSize: 22, margin: "7px 0 8px" }}>
              Exact context carried into this interview
            </h2>

            <div className="interview-context-actions">
              <Link
                href={`/applications/${application.id}`}
                className="btn btn-secondary"
              >
                View application
              </Link>

              {resumeUrl ? (
                <a
                  href={resumeUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="btn btn-secondary"
                >
                  Open submitted resume
                </a>
              ) : null}
            </div>

            <details className="interview-job-details">
              <summary>View frozen job description</summary>
              <div className="interview-job-copy">{jobDescription}</div>
            </details>
          </div>
        </section>

        <aside>
          <InterviewSettingsForm
            interviewId={interview.id}
            initial={{
              interview_type: interview.interview_type,
              response_style: interview.response_style,
              response_length: interview.response_length,
              duration_minutes: interview.duration_minutes,
            }}
          />

          <div className="card interview-live-card">
            <div className="muted" style={{ fontSize: 13 }}>
              {liveSession?.status === "ended" ? "Post-interview" : "Odysseus Live"}
            </div>
            <h3 style={{ fontSize: 22, margin: "7px 0 7px" }}>
              {liveSession?.status === "ended"
                ? postAnalysis
                  ? "Analysis is ready"
                  : "Interview transcript is ready"
                : "Live interview assistance"}
            </h3>
            <p className="muted" style={{ margin: "0 0 16px", lineHeight: 1.55 }}>
              {liveSession?.status === "ended"
                ? "Turn the completed transcript into factual round memory, preparation context, and a reviewable follow-up."
                : "This workspace is free. One interview pass is used only after the realtime connection successfully starts."}
            </p>
            {liveSession?.status === "ended" ? (
              <Link
                className="btn btn-primary"
                href={`/interviews/${interview.id}/analysis`}
              >
                {postAnalysis ? "View analysis" : "Analyze interview"}
              </Link>
            ) : (
              <Link className="btn btn-primary" href={`/interviews/${interview.id}/live`}>
                Start Odysseus Live
              </Link>
            )}
          </div>

          <div className="card interview-section-card">
            <div className="muted" style={{ fontSize: 13 }}>
              Application timeline
            </div>
            <div className="interview-timeline-mini">
              {timeline?.length ? (
                timeline.map((event) => (
                  <div key={event.id}>
                    <strong>{event.title}</strong>
                    {event.detail ? (
                      <span className="muted">{event.detail}</span>
                    ) : null}
                  </div>
                ))
              ) : (
                <span className="muted">No timeline events yet.</span>
              )}
            </div>
          </div>
        </aside>
      </div>
    </main>
  );
}
