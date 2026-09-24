import Link from "next/link";
import { notFound } from "next/navigation";
import MarketingNav from "@/components/marketing-nav";
import MarketingFooter from "@/components/marketing-footer";
import { careerJobBySlug } from "@/lib/careers/jobs";
import { getCareerRole } from "@/lib/careers/service";
import { submitCareerApplication } from "../actions";

export default async function CareerRolePage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ status?: string; error?: string }> }) {
  const { slug } = await params;
  const { status, error } = await searchParams;
  const job = careerJobBySlug[slug];
  const role = await getCareerRole(slug);
  if (!job || !role) notFound();
  const closed = role.status !== "open" || role.remaining <= 0;

  return (
    <main className="figma-site figma-soft-page">
      <div className="figma-page-wrap">
        <MarketingNav />
        <section style={{ width: "min(900px,100%)", margin: "54px auto 90px" }}>
          <Link className="figma-text-cta" href="/careers">← All careers</Link>
          <span className="figma-eyebrow" style={{ display: "block", marginTop: 28 }}>REMOTE · WORLDWIDE · PART-TIME · 20 HOURS/WEEK</span>
          <h1>{job.title}</h1>
          <p style={{ fontSize: 18 }}>{job.summary}</p>
          <p><strong>Startup environment.</strong> This is an early Odesseus founding-team role. We are accepting the first 100 completed applications worldwide.</p>
          <div className="figma-two-grid" style={{ marginTop: 28 }}>
            <article className="figma-info-card white"><h2>What you will do</h2>{job.responsibilities.map((x) => <p key={x}>✓ {x}</p>)}</article>
            <article className="figma-info-card white"><h2>What we are looking for</h2>{job.qualifications.map((x) => <p key={x}>✓ {x}</p>)}</article>
          </div>

          <section className="figma-info-card white" style={{ padding: 32, marginTop: 28 }}>
            <span className="figma-eyebrow">APPLICATION · FREE</span>
            <h2>Apply to join Odesseus</h2>
            <p className="muted">{role.application_count}/{role.application_limit} completed applications received. Odesseus-owned roles are free to apply to. Odesseus Live is optional and never affects hiring consideration.</p>
            {status === "success" ? <div className="billing-success">Application received. Check your email for confirmation.</div> : null}
            {error ? <div className="review-note">{error}</div> : null}
            {closed ? <div className="review-note">This role has reached its application limit and is now closed.</div> : (
              <form action={submitCareerApplication.bind(null, slug)} encType="multipart/form-data">
                <div className="figma-two-grid">
                  <label style={{ display:"grid",gap:8,fontWeight:650 }}>Full name<input className="input" name="full_name" required /></label>
                  <label style={{ display:"grid",gap:8,fontWeight:650 }}>Email<input className="input" name="email" type="email" required /></label>
                  <label style={{ display:"grid",gap:8,fontWeight:650 }}>Country<input className="input" name="country" required /></label>
                  <label style={{ display:"grid",gap:8,fontWeight:650 }}>Time zone<input className="input" name="time_zone" placeholder="e.g. UTC+1" /></label>
                  <label style={{ display:"grid",gap:8,fontWeight:650 }}>LinkedIn<input className="input" name="linkedin_url" type="url" /></label>
                  <label style={{ display:"grid",gap:8,fontWeight:650 }}>Portfolio / website<input className="input" name="portfolio_url" type="url" /></label>
                  <label style={{ display:"grid",gap:8,fontWeight:650 }}>GitHub<input className="input" name="github_url" type="url" /></label>
                  <label style={{ display:"grid",gap:8,fontWeight:650 }}>Years of experience<input className="input" name="years_experience" type="number" min="0" /></label>
                </div>
                <label style={{ display:"grid",gap:8,fontWeight:650,marginTop:18 }}>Weekly availability<input className="input" name="weekly_availability" placeholder="Days, hours, and time-zone overlap" required /></label>
                <label style={{ display:"grid",gap:8,fontWeight:650,marginTop:18 }}>Compensation expectation<input className="input" name="compensation_expectation" placeholder="Your expected hourly or monthly compensation in USD" /></label>
                <label style={{ display:"grid",gap:8,fontWeight:650,marginTop:18 }}>Why Odesseus?<textarea className="input" name="why_odesseus" rows={5} required /></label>
                <label style={{ display:"grid",gap:8,fontWeight:650,marginTop:18 }}>{job.screeningQuestion}<textarea className="input" name="screening_answer" rows={5} required /></label>
                <label style={{ display:"grid",gap:8,fontWeight:650,marginTop:18 }}>Resume — PDF or Word, max 5MB<input className="input" name="resume" type="file" accept=".pdf,.doc,.docx" required /></label>
                <button className="figma-btn figma-btn-orange" type="submit" style={{ width:"100%",marginTop:22 }}>Submit free application</button>
              </form>
            )}
          </section>
        </section>
      </div>
      <MarketingFooter />
    </main>
  );
}
