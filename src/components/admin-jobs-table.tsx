"use client";

import { useMemo, useState } from "react";
import Link from "next/link";

export type AdminJobRow = {
  id: string;
  title: string;
  status: string;
  statusLabel: string;
  location: string | null;
  orgId: string;
  orgName: string;
  featuredLabel: string | null;
  createdAt: string;
};

export default function AdminJobsTable({ jobs }: { jobs: AdminJobRow[] }) {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("all");

  const statuses = useMemo(() => [...new Set(jobs.map((job) => job.status))].sort(), [jobs]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return jobs.filter((job) => {
      if (status !== "all" && job.status !== status) return false;
      if (!q) return true;
      return [job.title, job.orgName].some((f) => f.toLowerCase().includes(q));
    });
  }, [jobs, query, status]);

  return (
    <>
      <div className="admin-toolbar">
        <input
          className="input"
          placeholder="Search by title or employer…"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <select className="input" value={status} onChange={(event) => setStatus(event.target.value)} style={{ maxWidth: 180 }}>
          <option value="all">All statuses</option>
          {statuses.map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
        <span className="muted">{filtered.length} of {jobs.length} jobs</span>
      </div>

      <div className="card admin-table">
        <div className="admin-row header" style={{ ["--admin-row-cols" as string]: "1.6fr 1.2fr .8fr 1fr" }}>
          <span>Job</span><span>Employer</span><span>Status</span><span>Featured</span>
        </div>
        {filtered.map((job) => (
          <Link
            href={`/admin/employers/${job.orgId}`}
            className="admin-row"
            key={job.id}
            style={{ ["--admin-row-cols" as string]: "1.6fr 1.2fr .8fr 1fr" }}
          >
            <span>
              <strong>{job.title}</strong>
              <small>{job.location || "—"}</small>
            </span>
            <span>{job.orgName}</span>
            <span>{job.statusLabel}</span>
            <span>{job.featuredLabel || "—"}</span>
          </Link>
        ))}
        {!filtered.length ? <div className="admin-empty">No jobs match this filter.</div> : null}
      </div>
    </>
  );
}
