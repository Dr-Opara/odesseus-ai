import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import PostAnalysisButton from "@/components/post-analysis-button";
import FollowUpEditor from "@/components/follow-up-editor";
import { postInterviewAnalysisSchema } from "@/lib/ai/schemas";

export default async function PostInterviewPage({
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
    .select("*,applications(company_name,role_title)")
    .eq("id", id)
    .eq("user_id", userId)
    .maybeSingle();

  if (!interview) notFound();

  const [
    { data: liveSession },
    { data: analysisRow },
  ] = await Promise.all([
    supabase
      .from("live_interview_sessions")
      .select("id,status,ended_at")
      .eq("interview_id", id)
      .eq("user_id", userId)
      .maybeSingle(),
    supabase
      .from("post_interview_analyses")
      .select("id,version_number,analysis,transcript_item_count,created_at")
      .eq("interview_id", id)
      .eq("user_id", userId)
      .order("version_number", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  const parsed = analysisRow
    ? postInterviewAnalysisSchema.safeParse(analysisRow.analysis)
    : null;
  const analysis = parsed?.success ? parsed.data : null;

  const { data: followUp } = analysisRow
    ? await supabase
        .from("follow_up_drafts")
        .select("id,recipient_email,recipient_name,subject,body,status,sent_at,send_provider,last_error")
        .eq("analysis_id", analysisRow.id)
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle()
    : { data: null };

  const company = interview.applications?.company_name || "Company";
  const role = interview.applications?.role_title || "Role";
  const canAnalyze = liveSession?.status === "ended";

  return (
    <main className="shell" style={{ padding: "54px 0 100px" }}>
      <Link href={`/interviews/${id}`} className="muted" style={{ fontSize: 14 }}>
        ← Interview workspace
      </Link>

      <div className="post-heading">
        <div>
          <div className="badge">Post-interview</div>
          <h1
            style={{
              fontSize: 46,
              letterSpacing: "-0.05em",
              margin: "14px 0 7px",
            }}
          >
            {role}
          </h1>
          <p className="muted" style={{ fontSize: 18, margin: 0 }}>
            {company}
          </p>
        </div>

        {canAnalyze ? (
          <PostAnalysisButton
            interviewId={id}
            hasAnalysis={Boolean(analysis)}
          />
        ) : null}
      </div>

      {!canAnalyze ? (
        <div className="card post-empty-card">
          <div className="badge">Transcript required</div>
          <h2 style={{ fontSize: 28, margin: "16px 0 7px" }}>
            Complete Odysseus Live first.
          </h2>
          <p className="muted" style={{ margin: 0, lineHeight: 1.6 }}>
            Post-interview analysis uses the completed Live transcript so it can stay grounded in what actually happened.
          </p>
        </div>
      ) : !analysis ? (
        <div className="card post-empty-card">
          <div className="badge">Ready to analyze</div>
          <h2 style={{ fontSize: 30, margin: "16px 0 8px" }}>
            Turn the transcript into useful memory.
          </h2>
          <p className="muted" style={{ margin: 0, lineHeight: 1.6 }}>
            Odysseus will summarize the discussion, extract clearly supported questions and topics, update round memory, and draft a follow-up without predicting the hiring outcome.
          </p>
        </div>
      ) : (
        <div className="post-grid">
          <section>
            <div className="card post-summary-card">
              <div className="muted" style={{ fontSize: 13 }}>
                Factual recap
              </div>
              <h2 style={{ fontSize: 28, margin: "8px 0 10px" }}>
                What the transcript supports
              </h2>
              <p className="muted" style={{ margin: 0, lineHeight: 1.65 }}>
                {analysis.factualSummary}
              </p>
              <div className="post-analysis-meta">
                <span>{analysisRow?.transcript_item_count ?? 0} transcript turns</span>
                <span>Analysis v{analysisRow?.version_number}</span>
              </div>
            </div>

            {analysis.transcriptLimitations.length ? (
              <div className="card post-section-card">
                <div className="muted" style={{ fontSize: 13 }}>
                  Transcript limitations
                </div>
                <div className="post-list">
                  {analysis.transcriptLimitations.map((item) => (
                    <div key={item}>{item}</div>
                  ))}
                </div>
              </div>
            ) : null}

            <div className="post-two-column">
              <div className="card post-section-card">
                <div className="muted" style={{ fontSize: 13 }}>
                  Questions captured
                </div>
                <div className="post-list">
                  {analysis.questionsAsked.length ? (
                    analysis.questionsAsked.map((item) => (
                      <div key={item}>{item}</div>
                    ))
                  ) : (
                    <span className="muted">No clearly supported questions were extracted.</span>
                  )}
                </div>
              </div>

              <div className="card post-section-card">
                <div className="muted" style={{ fontSize: 13 }}>
                  Topics discussed
                </div>
                <div className="post-list">
                  {analysis.topicsDiscussed.length ? (
                    analysis.topicsDiscussed.map((item) => (
                      <div key={item}>{item}</div>
                    ))
                  ) : (
                    <span className="muted">No clear topics were extracted.</span>
                  )}
                </div>
              </div>
            </div>

            {analysis.experiencesReferenced.length ? (
              <div className="card post-section-card">
                <div className="muted" style={{ fontSize: 13 }}>
                  Experiences referenced
                </div>
                <div className="post-list">
                  {analysis.experiencesReferenced.map((item) => (
                    <div key={item}>{item}</div>
                  ))}
                </div>
              </div>
            ) : null}

            {analysis.commitments.length ? (
              <div className="card post-section-card">
                <div className="muted" style={{ fontSize: 13 }}>
                  Commitments / follow-ups
                </div>
                <div className="post-list">
                  {analysis.commitments.map((item) => (
                    <div key={item}>{item}</div>
                  ))}
                </div>
              </div>
            ) : null}

            {analysis.answersToStrengthen.length ? (
              <div className="card post-section-card">
                <div className="muted" style={{ fontSize: 13 }}>
                  Answers to strengthen
                </div>
                <div className="post-strength-list">
                  {analysis.answersToStrengthen.map((item) => (
                    <div className="post-strength-item" key={item.topic}>
                      <strong>{item.topic}</strong>
                      <p className="muted">{item.observation}</p>
                      <div>
                        <span className="muted">Next time: </span>
                        {item.strongerApproach}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}

            {analysis.possibleNextRoundTopics.length ? (
              <div className="card post-section-card">
                <div className="muted" style={{ fontSize: 13 }}>
                  Possible next-round topics
                </div>
                <p className="muted" style={{ lineHeight: 1.55 }}>
                  These are plausible preparation areas suggested by the discussion and role, not predictions.
                </p>
                <div className="post-strength-list">
                  {analysis.possibleNextRoundTopics.map((item) => (
                    <div className="post-strength-item" key={item.topic}>
                      <strong>{item.topic}</strong>
                      <p className="muted">{item.rationale}</p>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
          </section>

          <aside>
            {followUp ? <FollowUpEditor draft={followUp} /> : null}

            <div className="card post-boundary-card">
              <div className="muted" style={{ fontSize: 13 }}>
                What Odysseus does not claim
              </div>
              <p className="muted" style={{ margin: "8px 0 0", lineHeight: 1.6 }}>
                No interview score, no hiring probability, and no assumption about interviewer intent. The purpose is memory, preparation, and follow-through.
              </p>
            </div>
          </aside>
        </div>
      )}
    </main>
  );
}
