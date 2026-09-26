import Link from "next/link";
import type { z } from "zod";
import MobileScreen from "@/components/mobile/mobile-screen";
import MobileTailoringActions from "@/components/mobile/mobile-tailoring-actions";
import { tailoredResumeSchema } from "@/lib/ai/schemas";
import type { CandidateResumeTailoring } from "@/lib/candidate/types";

type TailoredResume = z.infer<typeof tailoredResumeSchema>;

/**
 * Mobile Resume Review screen (screen 08) — the candidate's own tailor run:
 * the proposed version, every auditable change with its before/after and
 * verified evidence, and the approve/regenerate actions. Approval uses the
 * same shared `/api/tailor/[id]/approve` route as desktop; nothing is
 * silently applied and no facts are added (the review note states that).
 */
export default function MobileResumeReview({
  tailoring,
  tailored,
}: {
  tailoring: CandidateResumeTailoring;
  tailored: TailoredResume;
}) {
  const approved = tailoring.status === "approved";
  const changes = tailoring.changes;

  return (
    <MobileScreen
      index="08"
      title={
        tailoring.job?.role_title ||
        tailored.headline ||
        "Tailored resume"
      }
      lead={`${tailoring.job?.company_name || "Company"} · v${tailoring.versionNumber} · ${tailoring.improvementCount} changes proposed`}
      minHeight={844}
    >
      <div className="m-version-row">
        <span className="m-badge">
          {approved ? "Approved ✓" : `Draft · v${tailoring.versionNumber}`}
        </span>
        {tailoring.job?.match_score != null ? (
          <small className="m-muted-note">{tailoring.job.match_score}% source match</small>
        ) : null}
      </div>

      <p className="m-highlight-legend">
        🟢 Green highlights = AI-suggested improvements for this role
      </p>

      <section className="m-card m-note-card">
        <strong>Review every change before approval.</strong>
        <p className="muted">
          Odesseus can improve wording and relevance, but it cannot add
          experience or qualifications that are not already verified in your
          profile.
        </p>
      </section>

      <section className="m-section">
        <div className="m-section-heading">
          <h2>Proposed resume</h2>
        </div>
        <div className="m-preview-card">
          <strong className="m-preview-headline">
            {tailored.headline || tailoring.job?.role_title || "Professional Resume"}
          </strong>
          {tailored.professionalSummary ? (
            <p className="muted">{tailored.professionalSummary}</p>
          ) : null}

          {tailored.skills.length ? (
            <div>
              <small className="m-section-label">Top skills</small>
              <div className="m-chip-row m-skill-row">
                {tailored.skills.map((skill) => (
                  <span className="m-chip" key={skill}>{skill}</span>
                ))}
              </div>
            </div>
          ) : null}

          {tailored.roles.length ? (
            <div style={{ display: "grid", gap: 14 }}>
              <small className="m-section-label">Experience</small>
              {tailored.roles.map((role, index) => (
                <div key={`${role.company}-${role.title}-${index}`}>
                  <strong className="m-role-title">{role.title}</strong>
                  {role.company ? (
                    <div className="muted m-role-meta">{role.company}</div>
                  ) : null}
                  {role.bullets.length ? (
                    <ul className="m-bullets">
                      {role.bullets.map((bullet) => <li key={bullet}>{bullet}</li>)}
                    </ul>
                  ) : null}
                </div>
              ))}
            </div>
          ) : null}
        </div>
      </section>

      <section className="m-section">
        <div className="m-section-heading">
          <h2>What changed</h2>
        </div>

        {changes.length ? (
          <div style={{ display: "grid", gap: 10 }}>
            {changes.map((change: any, index: number) => (
              <div className="m-diff-card" key={index}>
                <div className="m-diff-top">
                  <strong className="m-diff-type">
                    {String(change.type).replaceAll("_", " ")}
                  </strong>
                  <span className="muted">{change.section}</span>
                </div>
                <div className="m-diff-pair">
                  <div>
                    <small>Before</small>
                    <p>{change.original || "Not previously emphasized"}</p>
                  </div>
                  <div className="is-revised">
                    <small>After</small>
                    <p>{change.revised || "Removed from tailored version"}</p>
                  </div>
                </div>
                <div className="m-diff-why">
                  <strong>Why Odesseus changed it</strong>
                  <p className="muted">{change.reason}</p>
                  {(change.verifiedEvidence || []).length ? (
                    <ul className="m-evidence">
                      {(change.verifiedEvidence as string[]).map((evidence) => (
                        <li key={evidence}>✓ {evidence}</li>
                      ))}
                    </ul>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="m-empty">No material changes were proposed for this version.</div>
        )}
      </section>

      <section className="m-approve-card">
        <div>
          <strong>
            {approved
              ? "This version is approved."
              : "Nothing is used until you approve it."}
          </strong>
          <p className="muted">
            {approved
              ? "Odesseus has frozen this version for the application workflow."
              : "Approve this version or regenerate another one."}
          </p>
        </div>

        <MobileTailoringActions
          tailoringId={tailoring.id}
          jobId={tailoring.jobId}
          approved={approved}
        />
      </section>

      {approved ? (
        <section className="m-next">
          <div>
            <strong>Ready to apply.</strong>
            <p className="muted">
              Odesseus will use this exact approved resume and pause whenever
              your input is required.
            </p>
          </div>
          <Link className="m-btn-primary m-btn-link" href={`/apply/start?job=${tailoring.jobId}`}>
            Apply with Odesseus
          </Link>
        </section>
      ) : null}

      <div className="m-back-link">
        <Link href={`/match/${tailoring.jobId}`}>← Back to match</Link>
      </div>
    </MobileScreen>
  );
}