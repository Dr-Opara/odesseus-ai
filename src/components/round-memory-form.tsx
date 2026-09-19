"use client";

import { FormEvent, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

function toLines(value: string) {
  return value
    .split("\n")
    .map((item) => item.trim())
    .filter(Boolean);
}

function fromLines(values?: string[] | null) {
  return (values || []).join("\n");
}

export default function RoundMemoryForm({
  interviewId,
  initial,
}: {
  interviewId: string;
  initial?: {
    questions_asked: string[];
    topics_discussed: string[];
    experiences_used: string[];
    interviewer_signals: string[];
    commitments: string[];
    candidate_notes: string | null;
  } | null;
}) {
  const router = useRouter();
  const [questions, setQuestions] = useState(
    fromLines(initial?.questions_asked)
  );
  const [topics, setTopics] = useState(
    fromLines(initial?.topics_discussed)
  );
  const [experiences, setExperiences] = useState(
    fromLines(initial?.experiences_used)
  );
  const [signals, setSignals] = useState(
    fromLines(initial?.interviewer_signals)
  );
  const [commitments, setCommitments] = useState(
    fromLines(initial?.commitments)
  );
  const [notes, setNotes] = useState(initial?.candidate_notes || "");
  const [markCompleted, setMarkCompleted] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  const hasAnyNotes = useMemo(
    () =>
      [questions, topics, experiences, signals, commitments, notes]
        .some((value) => value.trim().length > 0),
    [questions, topics, experiences, signals, commitments, notes]
  );

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setMessage("");

    const response = await fetch(
      `/api/interviews/${interviewId}/memory`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          questionsAsked: toLines(questions),
          topicsDiscussed: toLines(topics),
          experiencesUsed: toLines(experiences),
          interviewerSignals: toLines(signals),
          commitments: toLines(commitments),
          candidateNotes: notes.trim() || null,
          markCompleted,
        }),
      }
    );

    const data = await response.json();

    if (!response.ok) {
      setMessage(data.error || "Odysseus could not save round memory.");
      setBusy(false);
      return;
    }

    setMessage(`Round ${data.roundNumber} memory saved.`);
    setBusy(false);
    router.refresh();
  }

  return (
    <form className="card round-memory-card" onSubmit={submit}>
      <div>
        <div className="muted" style={{ fontSize: 13 }}>
          Round memory
        </div>
        <h2 style={{ fontSize: 24, margin: "7px 0 6px" }}>
          What should Odysseus remember?
        </h2>
        <p className="muted" style={{ margin: 0, lineHeight: 1.55 }}>
          One item per line. This becomes context for the next round.
        </p>
      </div>

      <label className="field-label">
        Questions asked
        <textarea
          className="input round-memory-textarea"
          value={questions}
          onChange={(event) => setQuestions(event.target.value)}
          placeholder={"Tell me about an ATO you supported\nHow do you handle POA&M risk?"}
        />
      </label>

      <label className="field-label">
        Topics discussed
        <textarea
          className="input round-memory-textarea"
          value={topics}
          onChange={(event) => setTopics(event.target.value)}
          placeholder={"RMF lifecycle\nContinuous monitoring"}
        />
      </label>

      <label className="field-label">
        Experiences you used
        <textarea
          className="input round-memory-textarea"
          value={experiences}
          onChange={(event) => setExperiences(event.target.value)}
          placeholder={"DOJ ATO example\nAI governance work"}
        />
      </label>

      <label className="field-label">
        Interviewer signals / comments
        <textarea
          className="input round-memory-textarea"
          value={signals}
          onChange={(event) => setSignals(event.target.value)}
          placeholder={"Asked for more detail on cloud controls\nMentioned next round is technical"}
        />
      </label>

      <label className="field-label">
        Commitments / follow-ups
        <textarea
          className="input round-memory-textarea"
          value={commitments}
          onChange={(event) => setCommitments(event.target.value)}
          placeholder={"Send portfolio link\nFollow up with availability"}
        />
      </label>

      <label className="field-label">
        Notes
        <textarea
          className="input round-memory-notes"
          value={notes}
          onChange={(event) => setNotes(event.target.value)}
          placeholder="Anything else worth carrying into the next round…"
        />
      </label>

      <label className="remember-answer">
        <input
          type="checkbox"
          checked={markCompleted}
          onChange={(event) => setMarkCompleted(event.target.checked)}
        />
        Mark this interview round complete
      </label>

      <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
        <button
          className="btn btn-primary"
          type="submit"
          disabled={busy || !hasAnyNotes}
        >
          {busy ? "Saving memory…" : "Save round memory"}
        </button>
        {message ? (
          <span className="muted" style={{ fontSize: 13 }}>
            {message}
          </span>
        ) : null}
      </div>
    </form>
  );
}
