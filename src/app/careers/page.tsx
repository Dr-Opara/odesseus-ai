import Link from "next/link";
import MarketingNav from "@/components/marketing-nav";
import MarketingFooter from "@/components/marketing-footer";
import { careerJobBySlug } from "@/lib/careers/jobs";
import { listCareerRoles } from "@/lib/careers/service";

export const metadata = { title: "Careers — Odesseus.ai" };

export default async function CareersPage() {
  const roles = await listCareerRoles();
  return (
    <main className="figma-site figma-soft-page">
      <div className="figma-page-wrap">
        <MarketingNav />
        <section className="figma-page-hero">
          <span className="figma-eyebrow">CAREERS · STARTUP TEAM</span>
          <h1>Help build the future of the job search.</h1>
          <p>We are building a small, global founding team around Odesseus. Every role is remote, part-time, and open to qualified applicants worldwide.</p>
        </section>
        <section style={{ paddingBottom: 72 }}>
          {roles.map((role: any) => {
            const job = careerJobBySlug[role.slug];
            if (!job) return null;
            const closed = role.status !== "open" || role.remaining <= 0;
            return (
              <article className="figma-info-card white" key={role.slug} style={{ marginBottom: 18 }}>
                <span className="figma-eyebrow">REMOTE · WORLDWIDE · PART-TIME</span>
                <h2>{job.title}</h2>
                <p>{job.summary}</p>
                <p className="muted">{closed ? "Applications closed" : `${role.application_count}/${role.application_limit} applications received · First 100 applicants`}</p>
                {closed ? <span className="figma-btn figma-btn-secondary">Closed</span> : <Link className="figma-btn figma-btn-orange" href={`/careers/${role.slug}`}>View role & apply</Link>}
              </article>
            );
          })}
        </section>
      </div>
      <MarketingFooter />
    </main>
  );
}
