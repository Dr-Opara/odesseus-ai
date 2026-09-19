"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";

export default function InterviewSettingsForm({
  interviewId,
  initial,
}: {
  interviewId: string;
  initial: {
    interview_type: string | null;
    response_style: string | null;
    response_length: string | null;
    duration_minutes: number | null;
  };
}) {
  const router = useRouter();
  const [interviewType, setInterviewType] = useState(
    initial.interview_type || "hiring_manager"
  );
  const [responseStyle, setResponseStyle] = useState(
    initial.response_style || "conversational"
  );
  const [responseLength, setResponseLength] = useState(
    initial.response_length || "30_45"
  );
  const [duration, setDuration] = useState(
    initial.duration_minutes ? String(initial.duration_minutes) : ""
  );
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setMessage("");

    const response = await fetch(
      `/api/interviews/${interviewId}/settings`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          interviewType,
          responseStyle,
          responseLength,
          durationMinutes: duration ? Number(duration) : null,
        }),
      }
    );

    const data = await response.json();

    if (!response.ok) {
      setMessage(data.error || "Could not save interview settings.");
      setBusy(false);
      return;
    }

    setMessage("Saved");
    setBusy(false);
    router.refresh();
  }

  return (
    <form className="card interview-settings-card" onSubmit={submit}>
      <div>
        <div className="muted" style={{ fontSize: 13 }}>
          Interview settings
        </div>
        <h2 style={{ fontSize: 22, margin: "7px 0 0" }}>
          How should Odysseus prepare?
        </h2>
      </div>

      <label className="field-label">
        Interview type
        <select
          className="input"
          value={interviewType}
          onChange={(event) => setInterviewType(event.target.value)}
        >
          <option value="recruiter">Recruiter screen</option>
          <option value="hiring_manager">Hiring manager</option>
          <option value="behavioral">Behavioral</option>
          <option value="technical">Technical</option>
          <option value="panel">Panel</option>
          <option value="executive">Executive</option>
          <option value="case_study">Case study</option>
          <option value="coding">Coding</option>
          <option value="cybersecurity_grc">Cybersecurity / GRC</option>
          <option value="software_engineering">Software engineering</option>
          <option value="ai_ml">AI / ML</option>
          <option value="agile_product">Agile / Product</option>
          <option value="other">Other</option>
        </select>
      </label>

      <label className="field-label">
        Response style
        <select
          className="input"
          value={responseStyle}
          onChange={(event) => setResponseStyle(event.target.value)}
        >
          <option value="conversational">Conversational</option>
          <option value="concise">Concise</option>
          <option value="detailed">Detailed</option>
          <option value="star">STAR</option>
          <option value="executive">Executive</option>
          <option value="technical">Technical</option>
        </select>
      </label>

      <label className="field-label">
        Response length
        <select
          className="input"
          value={responseLength}
          onChange={(event) => setResponseLength(event.target.value)}
        >
          <option value="15_30">15–30 seconds</option>
          <option value="30_45">30–45 seconds</option>
          <option value="45_60">45–60 seconds</option>
          <option value="detailed">Detailed</option>
        </select>
      </label>

      <label className="field-label">
        Expected duration <span className="muted">(minutes, optional)</span>
        <input
          className="input"
          value={duration}
          onChange={(event) => setDuration(event.target.value)}
          inputMode="numeric"
          placeholder="45"
        />
      </label>

      <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
        <button className="btn btn-primary" type="submit" disabled={busy}>
          {busy ? "Saving…" : "Save settings"}
        </button>
        {message ? (
          <span className="muted" style={{ fontSize: 13 }}>{message}</span>
        ) : null}
      </div>
    </form>
  );
}
