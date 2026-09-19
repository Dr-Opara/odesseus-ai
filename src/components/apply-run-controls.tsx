"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

type Question = {
  id: string;
  question_text: string;
  category: string;
};

export default function ApplyRunControls({
  runId,
  status,
  questions,
}: {
  runId: string;
  status: string;
  questions: Question[];
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [remember, setRemember] = useState<Record<string, boolean>>({});
  const [error, setError] = useState("");

  useEffect(() => {
    if (["submitted", "failed", "cancelled"].includes(status)) return;
    const timer = setInterval(() => router.refresh(), 3000);
    return () => clearInterval(timer);
  }, [router, status]);

  async function command(action: "continue" | "submit" | "cancel") {
    setBusy(true);
    setError("");

    const response = await fetch(`/api/apply/${runId}/command`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action }),
    });
    const data = await response.json();

    if (!response.ok) {
      setError(data.error || "Odysseus could not continue.");
      setBusy(false);
      return;
    }

    router.refresh();
    setBusy(false);
  }

  async function resolve() {
    setBusy(true);
    setError("");

    const payload = questions.map((question) => ({
      questionId: question.id,
      answer: answers[question.id] || "",
      remember: question.category !== "sensitive" && Boolean(remember[question.id]),
    }));

    const response = await fetch(`/api/apply/${runId}/resolve`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ answers: payload }),
    });
    const data = await response.json();

    if (!response.ok) {
      setError(data.error || "Odysseus could not save your answers.");
      setBusy(false);
      return;
    }

    router.refresh();
    setBusy(false);
  }

  if (status === "needs_user" && questions.length) {
    return (
      <div className="card apply-question-card">
        <div>
          <div className="muted" style={{ fontSize: 13 }}>Your input</div>
          <h2 style={{ margin: "7px 0 6px" }}>Odysseus needs a few answers.</h2>
          <p className="muted" style={{ margin: 0 }}>Answer only what the employer is asking. Sensitive answers are never saved for reuse.</p>
        </div>

        <div className="apply-question-list">
          {questions.map((question) => (
            <div key={question.id}>
              <label className="field-label">
                {question.question_text}
                <textarea
                  className="input apply-answer"
                  value={answers[question.id] || ""}
                  onChange={(event) =>
                    setAnswers((current) => ({ ...current, [question.id]: event.target.value }))
                  }
                />
              </label>
              {question.category !== "sensitive" ? (
                <label className="remember-answer">
                  <input
                    type="checkbox"
                    checked={Boolean(remember[question.id])}
                    onChange={(event) =>
                      setRemember((current) => ({ ...current, [question.id]: event.target.checked }))
                    }
                  />
                  Reuse this answer for similar future applications
                </label>
              ) : null}
            </div>
          ))}
        </div>

        {error ? <div className="apply-error">{error}</div> : null}
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <button className="btn btn-primary" onClick={resolve} disabled={busy}>
            {busy ? "Saving…" : "Save & continue"}
          </button>
          <button className="btn btn-secondary" onClick={() => command("cancel")} disabled={busy}>
            Cancel application
          </button>
        </div>
      </div>
    );
  }

  if (status === "needs_user") {
    return (
      <div>
        {error ? <div className="apply-error">{error}</div> : null}
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <button className="btn btn-primary" onClick={() => command("continue")} disabled={busy}>
            {busy ? "Checking page…" : "I’m done — continue"}
          </button>
          <button className="btn btn-secondary" onClick={() => command("cancel")} disabled={busy}>
            Cancel application
          </button>
        </div>
      </div>
    );
  }

  if (status === "ready_to_submit") {
    return (
      <div>
        {error ? <div className="apply-error">{error}</div> : null}
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <button className="btn btn-primary" onClick={() => command("submit")} disabled={busy}>
            {busy ? "Submitting…" : "Submit application"}
          </button>
          <button className="btn btn-secondary" onClick={() => command("cancel")} disabled={busy}>
            Cancel
          </button>
        </div>
      </div>
    );
  }

  if (!["submitted", "failed", "cancelled"].includes(status)) {
    return <span className="muted">Odysseus is working…</span>;
  }

  return null;
}
