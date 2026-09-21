const icons = {
  building: "M4 21V5a1 1 0 0 1 1-1h9a1 1 0 0 1 1 1v16 M15 21V9a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1v12 M8 8h2 M8 12h2 M8 16h2",
  pin: "M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z M12 13a3 3 0 1 0 0-6 3 3 0 0 0 0 6z",
  briefcase: "M3 8a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8z M8 6V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v1",
  clock: "M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z M12 6v6l4 2",
  dollar: "M12 1v22 M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H7",
  calendar: "M3 4h18v18H3z M16 2v4 M8 2v4 M3 10h18",
  check: "M20 6 9 17l-5-5",
};

function Icon({ name, size = 15 }: { name: keyof typeof icons; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={icons[name]} />
    </svg>
  );
}

const stats = [
  { value: "12", label: "Jobs to review" },
  { value: "8", label: "Applications in progress" },
  { value: "24", label: "Applications submitted" },
];

const topMatches = [
  { role: "Senior Compliance Analyst", company: "FinTech Company", location: "Remote", type: "Full-time", match: 94 },
  { role: "Senior GRC Analyst", company: "Healthcare Company", location: "Houston, TX / Remote", type: "Full-time", match: 91 },
  { role: "Cybersecurity Compliance Manager", company: "Federal Technology Company", location: "Washington, DC / Remote", type: "Full-time", match: 89 },
];

const jobDetails = [
  { icon: "building" as const, label: "Company", value: "FinTech Company" },
  { icon: "pin" as const, label: "Location", value: "Remote — United States" },
  { icon: "briefcase" as const, label: "Work type", value: "Remote" },
  { icon: "clock" as const, label: "Employment", value: "Full-time" },
  { icon: "briefcase" as const, label: "Experience", value: "Senior" },
  { icon: "dollar" as const, label: "Salary", value: "$120,000 – $155,000" },
  { icon: "calendar" as const, label: "Posted", value: "6 hours ago" },
];

const matchReasons = [
  "NIST / RMF experience",
  "Governance & compliance",
  "Cloud security",
  "Stakeholder leadership",
  "Risk management",
];

export default function JobDiscoveryShowcase() {
  return (
    <div className="jds-stage">
      <div className="jds-dashboard-cluster">
        <div className="jds-dashboard">
          <div className="jds-dashboard-head">Dashboard</div>

          <div className="jds-search-banner">
            <strong>Searching for Senior Compliance Analyst roles…</strong>
            <span>Search mode: Apply automatically after approval</span>
          </div>

          <div className="jds-stat-grid">
            {stats.map((s) => (
              <div className="jds-stat-card" key={s.label}>
                <strong>{s.value}</strong>
                <span>{s.label}</span>
              </div>
            ))}
          </div>

          <div className="jds-matches-head">Top matches to review</div>

          <div className="jds-matches-list">
            {topMatches.map((m) => (
              <div className="jds-match-row" key={m.role}>
                <div className="jds-match-role">
                  <strong>{m.role}</strong>
                  <span className="muted">{m.company}</span>
                </div>
                <span className="jds-match-meta">{m.location}</span>
                <span className="jds-match-meta">{m.type}</span>
                <span className="jds-match-score">{m.match}% Match</span>
              </div>
            ))}
          </div>
        </div>

        <div className="jds-apply-card">
          <span className="jds-apply-match">Match 94%</span>
          <div className="jds-apply-actions">
            <button className="btn btn-primary" type="button">Apply</button>
            <button className="btn btn-secondary" type="button">Review</button>
          </div>
        </div>
      </div>

      <div className="jds-job-cluster">
        <div className="jds-job-card">
          <h3 className="jds-job-title">Senior Compliance Analyst</h3>

          <dl className="jds-job-details">
            {jobDetails.map((d) => (
              <div className="jds-job-detail-row" key={d.label}>
                <dt>
                  <Icon name={d.icon} size={14} />
                  {d.label}
                </dt>
                <dd>{d.value}</dd>
              </div>
            ))}
          </dl>

          <div className="jds-job-why">
            <strong>Why this role matches</strong>
            <ul>
              {matchReasons.map((r) => (
                <li key={r}>
                  <Icon name="check" size={13} />
                  {r}
                </li>
              ))}
            </ul>
          </div>

          <p className="jds-job-summary muted">
            A senior-level compliance role focused on regulatory governance, risk frameworks, and cloud security oversight — closely aligned with your verified experience and preferences.
          </p>
        </div>

        <div className="jds-score-card">
          <span className="jds-score-label">Job Match Score</span>
          <strong className="jds-score-value">94%</strong>
          <div className="jds-score-bar">
            <div className="jds-score-bar-fill" style={{ width: "94%" }} />
          </div>
          <span className="jds-score-note">Strong match</span>
        </div>
      </div>
    </div>
  );
}
