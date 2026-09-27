export const metadata = { title: "Careers — Odesseus Admin" };

export default function AdminCareersPage() {
  return (
    <main className="shell admin-shell">
      <div className="admin-page-heading">
        <div>
          <div className="badge">Admin · Careers</div>
          <h1>Careers applications</h1>
          <p className="muted">There is no applicant-tracking backend for Careers yet.</p>
        </div>
      </div>

      <div className="card admin-section-card">
        <h2>How Careers applications arrive today</h2>
        <p>
          The public <code>/careers</code> page does not collect applications through a form or database table — it
          points candidates directly to <a href="mailto:careers@odesseus.ai">careers@odesseus.ai</a>. There is no
          applicant record, status, or review workflow to surface here.
        </p>
        <p className="muted" style={{ marginTop: 12 }}>
          Backend dependency: a careers-applications table (and a submission form that writes to it) would need to
          ship before this section can show real applicant data, review status, or a review workflow.
        </p>
      </div>
    </main>
  );
}
