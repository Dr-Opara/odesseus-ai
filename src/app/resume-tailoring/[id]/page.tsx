import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { resumeProfileSchema, tailoredResumeSchema } from "@/lib/ai/schemas";
import TailoringActions from "@/components/tailoring-actions";

export default async function ResumeTailoringPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getClaims();
  const userId = auth?.claims?.sub;

  if (!userId) redirect("/login");

  const { data: tailoring } = await supabase
    .from("resume_tailorings")
    .select("*,job_opportunities(company_name,role_title,match_score),resumes!resume_tailorings_source_resume_id_fkey(parsed_data)")
    .eq("id", id)
    .eq("user_id", userId)
    .maybeSingle();

  if (!tailoring) notFound();

  const tailored = tailoredResumeSchema.safeParse(tailoring.tailored_resume);
  const original = resumeProfileSchema.safeParse(tailoring.resumes?.parsed_data);

  if (!tailored.success || !original.success) notFound();

  const changes = Array.isArray(tailoring.changes) ? tailoring.changes : [];
  const job = tailoring.job_opportunities;

  return (
    <main className="shell" style={{ padding: "54px 0 100px" }}>
      <Link href="/dashboard" className="wordmark">Odysseus</Link>

      <div style={{ width: "min(1040px,100%)", margin: "58px auto 0" }}>
        <Link href={`/match/${tailoring.job_id}`} className="muted" style={{ fontSize: 14 }}>
          ← Back to match
        </Link>

        <div className="resume-review-heading">
          <div>
            <div className="badge">Resume review · v{tailoring.version_number}</div>
            <h1 style={{ fontSize: 46, letterSpacing: "-0.05em", margin: "16px 0 8px" }}>
              {job?.role_title || "Tailored resume"}
            </h1>
            <p className="muted" style={{ fontSize: 18, margin: 0 }}>
              {job?.company_name || "Company"} · {tailoring.improvement_count} changes proposed
            </p>
          </div>

          <TailoringActions
            tailoringId={tailoring.id}
            jobId={tailoring.job_id}
            approved={tailoring.status === "approved"}
          />
        </div>

        <div className="review-note">
          Odysseus can improve wording and relevance, but it cannot add experience or qualifications that are not already verified in your profile.
        </div>

        <div className="resume-preview card">
          <div className="resume-preview-header">
            <div>
              <h2 style={{ margin: 0 }}>{tailored.data.headline || job?.role_title || "Professional Resume"}</h2>
              <p className="muted" style={{ margin: "8px 0 0", lineHeight: 1.55 }}>{tailored.data.professionalSummary}</p>
            </div>
            {job?.match_score ? <div className="badge">{job.match_score}% source match</div> : null}
          </div>

          <section className="resume-section">
            <h3>Skills</h3>
            <div className="skill-wrap">
              {tailored.data.skills.map((skill) => <span key={skill} className="skill-chip">{skill}</span>)}
            </div>
          </section>

          <section className="resume-section">
            <h3>Experience</h3>
            <div style={{ display: "grid", gap: 28 }}>
              {tailored.data.roles.map((role, index) => (
                <article key={`${role.company}-${role.title}-${index}`}>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 20, flexWrap: "wrap" }}>
                    <div><strong>{role.title}</strong>{role.company ? <div className="muted" style={{ marginTop: 4 }}>{role.company}</div> : null}</div>
                    <div className="muted" style={{ fontSize: 13 }}>{[role.start, role.end].filter(Boolean).join(" – ")}</div>
                  </div>
                  <ul className="resume-bullets">
                    {role.bullets.map((bullet) => <li key={bullet}>{bullet}</li>)}
                  </ul>
                </article>
              ))}
            </div>
          </section>

          {tailored.data.certifications.length ? (
            <section className="resume-section">
              <h3>Certifications</h3>
              <p style={{ lineHeight: 1.7, margin: 0 }}>{tailored.data.certifications.join(" · ")}</p>
            </section>
          ) : null}

          {tailored.data.education.length ? (
            <section className="resume-section">
              <h3>Education</h3>
              <div style={{ display: "grid", gap: 10 }}>
                {tailored.data.education.map((item, index) => (
                  <div key={index}>
                    <strong>{item.degree}{item.field ? `, ${item.field}` : ""}</strong>
                    {item.institution ? <div className="muted" style={{ marginTop: 3 }}>{item.institution}</div> : null}
                  </div>
                ))}
              </div>
            </section>
          ) : null}
        </div>

        <div style={{ marginTop: 28 }}>
          <div className="muted" style={{ fontSize: 13 }}>What changed</div>
          <h2 style={{ fontSize: 28, margin: "7px 0 18px" }}>Review every change before approval.</h2>

          <div style={{ display: "grid", gap: 14 }}>
            {changes.map((change: any, index: number) => (
              <div className="card diff-card" key={index}>
                <div className="diff-card-top">
                  <div>
                    <span className="diff-type">{String(change.type).replaceAll("_", " ")}</span>
                    <strong style={{ marginLeft: 10 }}>{change.section}</strong>
                  </div>
                  <span className="muted" style={{ fontSize: 13 }}>Change {index + 1}</span>
                </div>

                <div className="diff-grid">
                  <div className="diff-pane">
                    <div className="muted diff-label">Before</div>
                    <p>{change.original || "Not previously emphasized"}</p>
                  </div>
                  <div className="diff-pane revised">
                    <div className="muted diff-label">After</div>
                    <p>{change.revised || "Removed from tailored version"}</p>
                  </div>
                </div>

                <div className="diff-reason">
                  <strong>Why Odysseus changed it</strong>
                  <p className="muted">{change.reason}</p>
                  <div className="evidence-box">
                    <div className="muted" style={{ fontSize: 12, marginBottom: 7 }}>Verified evidence</div>
                    {(change.verifiedEvidence || []).map((evidence: string) => (
                      <div key={evidence} style={{ fontSize: 13, lineHeight: 1.55 }}>✓ {evidence}</div>
                    ))}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {tailoring.status === "approved" ? (
          <div className="card apply-ready-card">
            <div>
              <div className="muted" style={{ fontSize: 13 }}>Next step</div>
              <h2 style={{ fontSize: 24, margin: "7px 0 5px" }}>Ready to apply.</h2>
              <p className="muted" style={{ margin: 0 }}>
                Odysseus will use this exact approved PDF and pause whenever your input is required.
              </p>
            </div>
            <Link className="btn btn-primary" href={`/apply/start?job=${tailoring.job_id}`}>
              Apply with Odysseus
            </Link>
          </div>
        ) : null}

        <div className="approval-footer card">
          <div>
            <div className="muted" style={{ fontSize: 13 }}>Approval</div>
            <h2 style={{ fontSize: 24, margin: "7px 0 5px" }}>
              {tailoring.status === "approved" ? "This version is approved." : "Nothing is used until you approve it."}
            </h2>
            <p className="muted" style={{ margin: 0 }}>
              {tailoring.status === "approved"
                ? "Odysseus has frozen this version for the application workflow."
                : "Approve this version or regenerate another one."}
            </p>
          </div>
          <TailoringActions
            tailoringId={tailoring.id}
            jobId={tailoring.job_id}
            approved={tailoring.status === "approved"}
          />
        </div>
      </div>
    </main>
  );
}
