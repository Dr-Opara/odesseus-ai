"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import OdesseusWordmark from "@/components/odesseus-wordmark";

/**
 * The guest's post-interview analysis (F12).
 *
 * This is the same experience an applicant gets, with the same sections and
 * the same boundaries, rendered from the guest token-scoped read. It is not a
 * simplified or separate design: one product, one analysis screen.
 *
 * Every input is the guest's own. The route builds it from the guest's
 * company, role, job description, and resume, with no applicant profile, no
 * applications, no prior-round memory, and no interviewer details. Nothing
 * here is visible to the link owner, and the follow-up draft carries no
 * recipient address because a guest never supplied one.
 *
 * Generation is a separate button, matching the applicant flow: the analysis is
 * produced from the completed Live transcript, not generated silently on
 * arrival, so the guest is told what is happening and can decline.
 */

type Analysis = {
  factualSummary: string;
  transcriptLimitations: string[];
  questionsAsked: string[];
  topicsDiscussed: string[];
  experiencesReferenced: string[];
  commitments: string[];
  answersToStrengthen: { topic: string; observation: string; strongerApproach: string }[];
  possibleNextRoundTopics: { topic: string; rationale: string }[];
};

type FollowUp = { id: string; subject: string; body: string; status: string };

type Payload = {
  ok: boolean;
  analysis: Analysis | null;
  versionNumber: number | null;
  transcriptItemCount: number;
  followUp: FollowUp | null;
  guestName: string | null;
  company: string | null;
  roleTitle: string | null;
  error?: string;
};

type ViewState =
  | { kind: "loading" }
  | { kind: "ready"; payload: Payload }
  | { kind: "invalid"; message: string }
  | { kind: "failed"; message: string }
  | { kind: "generating" };

function readError(payload: unknown, fallback: string): string {
  const error = (payload as { error?: unknown } | null)?.error;
  return typeof error === "string" && error ? error : fallback;
}

const RETIRED_MESSAGE =
  "This guest link is no longer active. Ask for a new link from the person who shared it.";

/**
 * Turns the analysis read into a state.
 *
 * Pure, for the same reason as the landing's. 403 and 404 are the same answer
 * on purpose -- distinguishing them would let someone probe which links once
 * existed -- and a 5xx is deliberately not treated as a dead link, for the same
 * reason the landing does not: a guest cannot obtain a new link on the spot, so
 * falsely telling them theirs is over is a dead end.
 */
export function classifyAnalysis(
  response: Response,
  payload: Payload | null
): ViewState {
  if (response.status === 403 || response.status === 404) {
    return { kind: "invalid", message: payload?.error ?? RETIRED_MESSAGE };
  }
  if (!response.ok || !payload) {
    return { kind: "failed", message: "Odesseus could not load your analysis. Please try again." };
  }
  return { kind: "ready", payload };
}

/** The single read. Returns a state; never touches React state. */
export async function fetchAnalysisState(token: string): Promise<ViewState> {
  try {
    const response = await fetch(
      `/api/live/guest-access/${encodeURIComponent(token)}/session/post-analysis`,
      { cache: "no-store" }
    );
    const payload = (await response.json().catch(() => null)) as Payload | null;
    return classifyAnalysis(response, payload);
  } catch {
    return { kind: "failed", message: "Odesseus could not reach the server. Please try again." };
  }
}

export default function LiveGuestAnalysis({ token }: { token: string }) {
  const [state, setState] = useState<ViewState>({ kind: "loading" });
  const base = `/api/live/guest-access/${encodeURIComponent(token)}/session`;

  // Mount only. The initial state is already `loading`.
  useEffect(() => {
    let cancelled = false;
    fetchAnalysisState(token).then((next) => {
      if (!cancelled) setState(next);
    });
    return () => {
      cancelled = true;
    };
  }, [token]);

  const load = useCallback(async () => {
    setState({ kind: "loading" });
    setState(await fetchAnalysisState(token));
  }, [token]);

  const generate = useCallback(async () => {
    setState({ kind: "generating" });
    try {
      const response = await fetch(`${base}/post-analysis`, { method: "POST" });
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        setState({
          kind: "failed",
          message: readError(payload, "Odesseus could not analyze this interview."),
        });
        return;
      }
      // Read it back rather than assuming success: the POST returns ids, so
      // the content is only real once the GET agrees that it exists.
      setState(await fetchAnalysisState(token));
    } catch {
      setState({
        kind: "failed",
        message: "Odesseus could not reach the server. Please try again.",
      });
    }
  }, [base, token]);

  return (
    // Same container and heading block as the applicant Live page, so the
    // guest's post-interview view is the same product surface, not a variant.
    <main className="shell" style={{ padding: "36px 0 90px" }}>
      <div className="live-page-heading">
        <div>
          <OdesseusWordmark href="/" size="sm" />

          <div className="badge" style={{ marginTop: 16 }}>
            Post-interview
          </div>

          <h1 style={{ fontSize: 42, letterSpacing: "-0.05em", margin: "14px 0 6px" }}>
            What the transcript supports
          </h1>
        </div>

        {/* The guest's own company and role, or their own name. All of it
            supplied by the guest through this link. */}
        {state.kind === "ready" && state.payload ? (
          <div className="live-meeting-meta">
            <span>{state.payload.roleTitle || state.payload.guestName || "Interview"}</span>
            {state.payload.company ? (
              <span className="muted">{state.payload.company}</span>
            ) : null}
          </div>
        ) : null}
      </div>

      {/* The analysis is a reading surface and wants the narrower measure; the
          header above stays full width, matching the Live pages. */}
      <div style={{ width: "min(820px,100%)" }}>
        {state.kind === "loading" ? (
          <p className="muted" role="status" aria-live="polite">
            Loading your analysis…
          </p>
        ) : state.kind === "invalid" ? (
          <section className="card post-empty-card" style={{ marginTop: 24 }}>
            <h2 style={{ fontSize: 28, margin: "0 0 8px" }}>
              This link is no longer active.
            </h2>
            <p className="muted" style={{ margin: 0, lineHeight: 1.6 }}>
              {state.message}
            </p>
          </section>
        ) : state.kind === "failed" ? (
          <section className="card post-empty-card" style={{ marginTop: 24 }}>
            <h2 style={{ fontSize: 28, margin: "0 0 8px" }}>
              Odesseus could not load your analysis.
            </h2>
            <p className="muted" style={{ margin: "0 0 18px", lineHeight: 1.6 }}>
              {state.message}
            </p>
            <button type="button" className="btn btn-primary" onClick={() => void load()}>
              Try again
            </button>
          </section>
        ) : state.kind === "generating" ? (
          <p className="muted" role="status" aria-live="polite">
            Building your analysis from the interview transcript…
          </p>
        ) : state.kind === "ready" && !state.payload.analysis ? (
          <section className="card post-empty-card" style={{ marginTop: 24 }}>
            <div className="badge">Ready to analyze</div>
            <h2 style={{ fontSize: 28, margin: "16px 0 8px" }}>
              Turn the transcript into useful memory.
            </h2>
            <p className="muted" style={{ margin: "0 0 18px", lineHeight: 1.6 }}>
              Odesseus will summarize the discussion, extract clearly supported
              questions and topics, and draft a follow-up without predicting the
              hiring outcome.
            </p>
            <button type="button" className="btn btn-primary" onClick={() => void generate()}>
              Generate analysis
            </button>
          </section>
        ) : state.kind === "ready" ? (
          <>
            {/* The company and role are already in the header's meta block,
                so they are not repeated here. */}
            <div className="post-grid" style={{ marginTop: 24 }}>
              <section>
                <div className="card post-summary-card">
                  <div className="muted" style={{ fontSize: 13 }}>
                    Factual recap
                  </div>
                  <h2 style={{ fontSize: 28, margin: "8px 0 10px" }}>
                    What the transcript supports
                  </h2>
                  <p className="muted" style={{ margin: 0, lineHeight: 1.65 }}>
                    {state.payload.analysis?.factualSummary}
                  </p>
                  <div className="post-analysis-meta">
                    <span>{state.payload.transcriptItemCount} transcript turns</span>
                    {state.payload.versionNumber ? (
                      <span>Analysis v{state.payload.versionNumber}</span>
                    ) : null}
                  </div>
                </div>

                {state.payload.analysis?.transcriptLimitations.length ? (
                  <div className="card post-section-card">
                    <div className="muted" style={{ fontSize: 13 }}>
                      Transcript limitations
                    </div>
                    <div className="post-list">
                      {state.payload.analysis.transcriptLimitations.map((item) => (
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
                      {state.payload.analysis?.questionsAsked.length ? (
                        state.payload.analysis.questionsAsked.map((item) => (
                          <div key={item}>{item}</div>
                        ))
                      ) : (
                        <span className="muted">
                          No clearly supported questions were extracted.
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="card post-section-card">
                    <div className="muted" style={{ fontSize: 13 }}>
                      Topics discussed
                    </div>
                    <div className="post-list">
                      {state.payload.analysis?.topicsDiscussed.length ? (
                        state.payload.analysis.topicsDiscussed.map((item) => (
                          <div key={item}>{item}</div>
                        ))
                      ) : (
                        <span className="muted">No clear topics were extracted.</span>
                      )}
                    </div>
                  </div>
                </div>

                {state.payload.analysis?.experiencesReferenced.length ? (
                  <div className="card post-section-card">
                    <div className="muted" style={{ fontSize: 13 }}>
                      Experiences referenced
                    </div>
                    <div className="post-list">
                      {state.payload.analysis.experiencesReferenced.map((item) => (
                        <div key={item}>{item}</div>
                      ))}
                    </div>
                  </div>
                ) : null}

                {state.payload.analysis?.commitments.length ? (
                  <div className="card post-section-card">
                    <div className="muted" style={{ fontSize: 13 }}>
                      Commitments / follow-ups
                    </div>
                    <div className="post-list">
                      {state.payload.analysis.commitments.map((item) => (
                        <div key={item}>{item}</div>
                      ))}
                    </div>
                  </div>
                ) : null}

                {state.payload.analysis?.answersToStrengthen.length ? (
                  <div className="card post-section-card">
                    <div className="muted" style={{ fontSize: 13 }}>
                      Answers to strengthen
                    </div>
                    <div className="post-strength-list">
                      {state.payload.analysis.answersToStrengthen.map((item) => (
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

                {state.payload.analysis?.possibleNextRoundTopics.length ? (
                  <div className="card post-section-card">
                    <div className="muted" style={{ fontSize: 13 }}>
                      Possible next-round topics
                    </div>
                    <p className="muted" style={{ lineHeight: 1.55 }}>
                      These are plausible preparation areas suggested by the
                      discussion and role, not predictions.
                    </p>
                    <div className="post-strength-list">
                      {state.payload.analysis.possibleNextRoundTopics.map((item) => (
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
                {state.payload.followUp ? (
                  <div className="card post-section-card">
                    <div className="muted" style={{ fontSize: 13 }}>
                      Follow-up draft
                    </div>
                    <h3 style={{ fontSize: 20, margin: "8px 0 6px" }}>
                      {state.payload.followUp.subject}
                    </h3>
                    <p
                      className="muted"
                      style={{ whiteSpace: "pre-wrap", lineHeight: 1.6, margin: 0 }}
                    >
                      {state.payload.followUp.body}
                    </p>
                    <p className="muted" style={{ marginTop: 12, fontSize: 13 }}>
                      A draft only. Nothing is sent, and there is no address to
                      send it to.
                    </p>
                  </div>
                ) : null}

                <div className="card post-boundary-card">
                  <div className="muted" style={{ fontSize: 13 }}>
                    What Odesseus does not claim
                  </div>
                  <p className="muted" style={{ margin: "8px 0 0", lineHeight: 1.6 }}>
                    No interview score, no hiring probability, and no assumption
                    about interviewer intent. The purpose is memory, preparation,
                    and follow-through.
                  </p>
                </div>
              </aside>
            </div>

            <div className="emp-page-actions" style={{ marginTop: 18 }}>
              <Link className="btn btn-secondary" href={`/guest-live/${encodeURIComponent(token)}`}>
                Back to Guest Live
              </Link>
            </div>
          </>
        ) : null}
      </div>
    </main>
  );
}