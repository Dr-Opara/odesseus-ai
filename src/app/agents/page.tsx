import type { Metadata } from "next";
import MarketingNav from "@/components/marketing-nav";
import MarketingFooter from "@/components/marketing-footer";

export const metadata: Metadata = {
  title: "Odesseus Agents — Match, Apply & Interview",
  description: "Meet the three Odesseus agents that qualify a job, improve your existing resume, apply after approval, and prepare you for interviews.",
};

export default function AgentsPage() {
  return (
    <main className="marketing">
      <div className="shell" style={{ paddingTop: 16 }}><MarketingNav /></div>

      <section className="shell page-hero agents-hero">
        <div className="badge">Odesseus Agents</div>
        <h1 className="font-display page-hero-headline">Three agents. One job-to-interview workflow.</h1>
        <p className="muted page-hero-copy">
          Odesseus works from your existing resume, keeps you in control before an application is submitted, and does not require access to your email.
        </p>
        <div className="agents-flow" aria-label="Odesseus agent workflow">
          <span>Match & Qualify</span><b>→</b><span>Improve & Approve</span><b>→</b><span>Apply</span><b>→</b><span>Prepare</span><b>→</b><span>Interview</span>
        </div>
      </section>

      <section className="shell agents-list">
        <article className="card agent-detail-card" id="match-agent">
          <div className="agent-detail-number">01</div>
          <div>
            <span className="stage-band-label">Job Match & Qualification Agent</span>
            <h2>Know whether the job fits — then improve the resume you already have.</h2>
            <p className="muted agent-detail-lead">
              Paste the job description and Odesseus analyzes it against your uploaded resume. It checks hard requirements, scores the match, then edits that existing resume to better reflect what the role asks for using only facts supported by your experience.
            </p>
            <div className="agent-detail-grid">
              <div><strong>You provide</strong><p>Existing resume + job description.</p></div>
              <div><strong>Odesseus does</strong><p>Qualification checks, match scoring, and job-specific edits to your existing resume.</p></div>
              <div><strong>You approve</strong><p>The revised resume and every material change before it can be used.</p></div>
              <div><strong>Output</strong><p>Original score, updated score, before/after changes, and an approved application-ready resume.</p></div>
            </div>
            <div className="marketing-callout">
              Odesseus does not create a resume from scratch. It improves the resume you already have, and it never invents qualifications to raise a score.
            </div>
          </div>
        </article>

        <article className="card agent-detail-card" id="application-agent">
          <div className="agent-detail-number">02</div>
          <div>
            <span className="stage-band-label">Application Agent</span>
            <h2>Approve it. Odesseus handles the application.</h2>
            <p className="muted agent-detail-lead">
              After you approve the revised resume, the Application Agent uses that exact version and your saved profile information to complete supported applications.
            </p>
            <div className="agent-detail-grid">
              <div><strong>You provide</strong><p>Your approved resume and saved candidate information.</p></div>
              <div><strong>Odesseus does</strong><p>Completes supported fields, uploads the approved resume, pauses for new input when needed, and verifies submission.</p></div>
              <div><strong>You approve</strong><p>The resume before application automation begins. New questions can return to you when a decision is required.</p></div>
              <div><strong>Output</strong><p>A dashboard record for every attempt and a $0.99 charge only after a verified successful submission.</p></div>
            </div>
            <div className="billing-rule-grid">
              <div className="billing-rule-item is-charge"><span>Successful submission</span><span className="billing-rule-amount">$0.99</span></div>
              <div className="billing-rule-item"><span>Failed submission</span><span className="billing-rule-amount">$0</span></div>
              <div className="billing-rule-item"><span>Needs your input</span><span className="billing-rule-amount">$0</span></div>
            </div>
          </div>
        </article>

        <article className="card agent-detail-card" id="interview-agent">
          <div className="agent-detail-number">03</div>
          <div>
            <span className="stage-band-label">Interview Agent</span>
            <h2>Prepare for every interview.</h2>
            <p className="muted agent-detail-lead">
              When you receive an interview invitation, come back to Odesseus. Select a tracked application or paste the JD and choose the resume you used. Interview preparation is free.
            </p>

            <div className="agent-detail-grid">
              <div><strong>You provide</strong><p>JD, resume used, interview stage, and any context you want Odesseus to know.</p></div>
              <div><strong>Odesseus prepares</strong><p>Likely questions, grounded STAR examples, talking points, technical topics, and questions to ask.</p></div>
              <div><strong>You configure</strong><p>OpenAI model, answer length, response style, and your editable interview prompt.</p></div>
              <div><strong>Output</strong><p>Role-specific questions, STAR-ready talking points, and technical topics grounded in your resume and the job description.</p></div>
            </div>

            <div className="marketing-callout">
              Preparation stays grounded in the resume you approved and the job you applied to — no invented experience.
            </div>
          </div>
        </article>
      </section>

      <MarketingFooter />
    </main>
  );
}
