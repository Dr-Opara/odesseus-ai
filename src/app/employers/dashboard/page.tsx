import Link from "next/link";
import EmployerNav from "@/components/employer-nav";

export default function EmployerDashboardPage() {
  return (
    <main className="figma-site figma-soft-page">
      <div className="figma-page-wrap">
        <EmployerNav />
        <section style={{ padding: "54px 0 80px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 20, alignItems: "end", flexWrap: "wrap" }}>
            <div><span className="figma-eyebrow">FOR EMPLOYERS</span><h1>Dashboard</h1><p className="muted">Here’s how your hiring is going.</p></div>
            <Link className="figma-btn figma-btn-orange" href="/employers/post-job">+ Post a Job</Link>
          </div>
          <div className="figma-three-grid" style={{ marginTop: 30 }}>
            <article className="figma-info-card white"><h2>4</h2><p>Active Jobs</p></article>
            <article className="figma-info-card cyan"><h2>156</h2><p>Applicants</p></article>
            <article className="figma-info-card lavender"><h2>31</h2><p>Strong Matches</p></article>
          </div>
          <div className="figma-two-grid" style={{ marginTop: 24 }}>
            <article className="figma-info-card white"><h2>GenAI Security Engineer</h2><p>Lagos, Nigeria · Hybrid</p><p>83 Applicants · 14 Strong Matches · 7 Reviewed · 3 Shortlisted</p></article>
            <article className="figma-info-card peach"><h2>Credits Remaining</h2><strong style={{ fontSize: 34 }}>3 / 5</strong><p>AI Starter Bundle</p><Link href="/employers/pricing" className="link">View pricing</Link></article>
          </div>
        </section>
      </div>
    </main>
  );
}
