"use client";

import { useMemo, useState } from "react";
import Link from "next/link";

export type AdminApplicationRunRow = {
  id: string;
  userEmail: string | null;
  companyName: string | null;
  roleTitle: string | null;
  executionMode: string;
  status: string;
  stopReason: string | null;
  createdAt: string;
};

const STATUS_TONE: Record<string, "good" | "bad" | "neutral"> = {
  submitted: "good",
  failed: "bad",
  cancelled: "bad",
  needs_user: "neutral",
};

function toneClass(status: string) {
  const tone = STATUS_TONE[status] || "neutral";
  if (tone === "good") return "readiness-status good";
  if (tone === "bad") return "readiness-status bad";
  return "badge";
}

export default function AdminApplicationsTable({ runs }: { runs: AdminApplicationRunRow[] }) {
  const [query, setQuery] = useState("");
  const [tier, setTier] = useState("all");
  const [status, setStatus] = useState("all");

  const statuses = useMemo(() => [...new Set(runs.map((run) => run.status))].sort(), [runs]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return runs.filter((run) => {
      if (tier !== "all" && run.executionMode !== tier) return false;
      if (status !== "all" && run.status !== status) return false;
      if (!q) return true;
      return [run.userEmail, run.companyName, run.roleTitle].filter(Boolean).some((f) => f!.toLowerCase().includes(q));
    });
  }, [runs, query, tier, status]);

  return (
    <>
      <div className="admin-toolbar">
        <input
          className="input"
          placeholder="Search by applicant, company, or role…"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <select className="input" value={tier} onChange={(event) => setTier(event.target.value)} style={{ maxWidth: 160 }}>
          <option value="all">All tiers</option>
          <option value="standard">Standard Apply</option>
          <option value="smart">Smart Apply</option>
        </select>
        <select className="input" value={status} onChange={(event) => setStatus(event.target.value)} style={{ maxWidth: 180 }}>
          <option value="all">All statuses</option>
          {statuses.map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
        <span className="muted">{filtered.length} of {runs.length} runs</span>
      </div>

      <div className="card admin-table">
        <div className="admin-row header" style={{ ["--admin-row-cols" as string]: "1.4fr 1.2fr .7fr .8fr .9fr" }}>
          <span>Applicant</span><span>Role</span><span>Tier</span><span>Status</span><span>Started</span>
        </div>
        {filtered.map((run) => (
          <Link
            href={`/admin/applications/${run.id}`}
            className="admin-row"
            key={run.id}
            style={{ ["--admin-row-cols" as string]: "1.4fr 1.2fr .7fr .8fr .9fr" }}
          >
            <span><strong>{run.userEmail || "—"}</strong></span>
            <span>
              <strong>{run.roleTitle || "—"}</strong>
              <small>{run.companyName || "—"}</small>
            </span>
            <span>{run.executionMode === "smart" ? "Smart" : "Standard"}</span>
            <span className={toneClass(run.status)}>{run.status.replace(/_/g, " ")}</span>
            <span>{new Date(run.createdAt).toLocaleDateString()}</span>
          </Link>
        ))}
        {!filtered.length ? <div className="admin-empty">No application runs match this filter.</div> : null}
      </div>
    </>
  );
}
