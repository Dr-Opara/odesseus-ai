import Link from "next/link";
import MarketingNav from "@/components/marketing-nav";
import MarketingFooter from "@/components/marketing-footer";

const workflow = [
  ["01", "Find", "Discover roles that match your experience, preferences, and goals."],
  ["02", "Match", "See how well your current resume fits before you spend time applying."],
  ["03", "Optimize", "Adapt the resume you already have to the role — without inventing experience."],
  ["04", "Apply", "Choose Apply or Smart Apply and let Odesseus complete the application."],
  ["05", "Track", "Keep every application, response, and next step in one place."],
  ["06", "Prepare", "When an interview arrives, your interview workspace is ready."],
];

export default function Home() {
  return (
    <main className="odesseus-marketing">
      <section className="od-home">
        <MarketingNav />

        <section className="od-hero">
          <div className="od-hero-copy">
            <span className="od-kicker">YOUR AI AGENT FOR GETTING HIRED</span>
            <h1>Stop applying manually.</h1>
            <p className="od-hero-lead">
              Odesseus finds better-fit jobs, optimizes the resume you already have,
              completes applications, tracks responses, and helps you prepare when interviews arrive.
            </p>
            <div className="od-hero-actions">
              <Link className="od-primary-btn" href="/signup">Start for free</Link>
              <Link className="od-secondary-link" href="/how-it-works">See how it works →</Link>
            </div>
            <div className="od-price-strip">
              <span><strong>Apply</strong> $0.39</span>
              <span><strong>Smart Apply</strong> $0.99</span>
              <span><strong>Interview Prep</strong> Free</span>
            </div>
          </div>

          <div className="od-product-preview" aria-label="Odesseus application workflow preview">
            <div className="od-preview-top">
              <div>
                <span className="od-preview-company">Cloud Security Engineer</span>
                <strong>92% Match</strong>
              </div>
              <span className="od-match-pill">Strong match</span>
            </div>
            <div className="od-preview-rows">
              <div><span>Current resume</span><strong>Ready</strong></div>
              <div><span>Resume optimization</span><strong>8 improvements</strong></div>
              <div><span>Application answers</span><strong>Prepared</strong></div>
              <div><span>Tracking</span><strong>Included</strong></div>
            </div>
            <div className="od-preview-actions">
              <div><span>Apply</span><strong>$0.39</strong><small>Existing resume</small></div>
              <div className="featured"><span>Smart Apply</span><strong>$0.99</strong><small>Optimize + submit</small></div>
            </div>
            <div className="od-preview-success">✓ Charged only after a successful submission</div>
          </div>
        </section>

        <section className="od-proof-strip">
          <div><strong>No application subscription</strong><span>Pay only when Odesseus successfully submits.</span></div>
          <div><strong>Your resume stays factual</strong><span>Optimize what you already have. No invented experience.</span></div>
          <div><strong>One workflow</strong><span>Find → Match → Optimize → Apply → Track → Prepare.</span></div>
        </section>

        <section className="od-section">
          <div className="od-section-heading">
            <span className="od-kicker">ONE JOB-SEARCH WORKFLOW</span>
            <h2>Odesseus handles the busywork between finding a job and getting the interview.</h2>
          </div>
          <div className="od-workflow-grid">
            {workflow.map(([number, title, copy]) => (
              <article key={number}>
                <span>{number}</span>
                <h3>{title}</h3>
                <p>{copy}</p>
              </article>
            ))}
          </div>
        </section>

        <section className="od-section od-demo-section">
          <div className="od-section-heading">
            <span className="od-kicker">NOT JUST ANOTHER JOB BOARD</span>
            <h2>See what Odesseus does after you find the job.</h2>
          </div>
          <div className="od-demo-grid">
            <article className="od-demo-card">
              <span className="od-card-label">MATCH</span>
              <strong>87%</strong>
              <h3>Know your fit before you apply.</h3>
              <p>See aligned skills, missing requirements, and where your current resume can be stronger.</p>
            </article>
            <article className="od-demo-card">
              <span className="od-card-label">OPTIMIZE</span>
              <strong>+12</strong>
              <h3>Improve the resume you already have.</h3>
              <p>Odesseus tailors emphasis and wording to the role while preserving your actual experience.</p>
            </article>
            <article className="od-demo-card">
              <span className="od-card-label">TRACK</span>
              <div className="od-tracker-mini">
                <span><b>Microsoft</b><em>Interview</em></span>
                <span><b>AWS</b><em>Applied</em></span>
                <span><b>Centene</b><em>Reviewing</em></span>
              </div>
              <h3>Keep the search organized.</h3>
              <p>Applications, submitted resumes, responses, interviews, and follow-ups stay connected.</p>
            </article>
          </div>
        </section>

        <section className="od-section od-price-attack">
          <div>
            <span className="od-kicker">PAY FOR RESULTS, NOT ACCESS</span>
            <h2>Why pay a big monthly fee just to apply for jobs?</h2>
            <p>Fund your Odesseus Wallet once. Pay only when an application is successfully submitted.</p>
          </div>
          <div className="od-price-cards">
            <article>
              <span>Apply</span>
              <strong>$0.39</strong>
              <p>Use your approved existing resume and verified profile.</p>
            </article>
            <article className="featured">
              <span>Smart Apply</span>
              <strong>$0.99</strong>
              <p>Analyze the JD, optimize your resume, generate answers, and submit.</p>
            </article>
          </div>
          <Link className="od-primary-btn" href="/pricing">See candidate pricing</Link>
        </section>

        <section className="od-section od-earn-section">
          <div>
            <span className="od-kicker">EARN WITH ODESSEUS</span>
            <h2>Your job search can pay you back.</h2>
            <p>
              Eligible annual members can share premium interview access with up to
              10 unique friends and earn from guest sessions while they continue their own job search.
            </p>
            <div className="od-earn-steps">
              <span><b>1</b> Join</span>
              <span><b>2</b> Invite</span>
              <span><b>3</b> Earn</span>
            </div>
            <Link className="od-secondary-link" href="/earn">See earning options →</Link>
          </div>
          <div className="od-earn-card">
            <small>ANNUAL MEMBER EXAMPLE</small>
            <strong>10</strong>
            <span>guest opportunities</span>
            <p>Each guest uses their own account and private interview workspace.</p>
          </div>
        </section>

        <section className="od-section od-employer-section">
          <div>
            <span className="od-kicker">FOR EMPLOYERS</span>
            <h2>Post once. Let AI surface the candidates worth reviewing.</h2>
            <p>Post roles, review matched applicants, manage your hiring pipeline, and add featured reach when you need it.</p>
            <Link className="od-secondary-link" href="/employers">Explore Odesseus for Employers →</Link>
          </div>
          <div className="od-employer-prices">
            <span><strong>$79</strong><small>3 active jobs</small></span>
            <span><strong>$149</strong><small>10 active jobs</small></span>
            <span><strong>$299</strong><small>25 active jobs</small></span>
          </div>
        </section>

        <section className="od-section od-final-cta">
          <span className="od-kicker">START WITH THE NEXT JOB</span>
          <h2>Upload the resume you already have. Odesseus handles the rest of the workflow.</h2>
          <div>
            <Link className="od-primary-btn" href="/signup">Create free account</Link>
            <Link className="od-secondary-link" href="/careers">See Odesseus careers →</Link>
          </div>
        </section>
      </section>
      <MarketingFooter />
    </main>
  );
}
