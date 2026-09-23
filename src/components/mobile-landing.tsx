import Link from "next/link";

export default function MobileLanding() {
  return (
    <div className="odesseus-mobile-only mobile-landing">
      <section className="mobile-splash" aria-label="Odesseus mobile introduction">
        <span className="mobile-splash-orb mobile-splash-orb-one" aria-hidden="true" />
        <span className="mobile-splash-orb mobile-splash-orb-two" aria-hidden="true" />
        <div className="mobile-job-stack" aria-label="Live job matches">
          <div className="mobile-job-card mobile-job-back lime">NVIDIA</div>
          <div className="mobile-job-card mobile-job-back pink">Amazon</div>
          <div className="mobile-job-card mobile-job-back cyan">Google</div>
          <article className="mobile-job-card mobile-job-main">
            <div className="mobile-job-company"><span className="mobile-ms-mark" aria-hidden="true">⊞</span><strong>Microsoft</strong><span className="mobile-heart" aria-hidden="true">♡</span></div>
            <h2>GenAI Security<br />Engineer</h2>
            <p>Full time &nbsp; | &nbsp; $247K</p>
            <div className="mobile-job-actions"><Link href="/jobs">See Details →</Link><span>Next Match →</span></div>
          </article>
        </div>
        <div className="mobile-splash-copy">
          <h1>Discover Your<br /><span>Dream Job</span><br />with <span>Odesseus.ai</span></h1>
          <p>Find roles that fit your experience, strengthen your resume, apply with your approval, and prepare for what comes next.</p>
          <Link className="mobile-primary-cta" href="/signup"><span>Get Started</span><b aria-hidden="true">→</b></Link>
          <div className="mobile-splash-pager" aria-hidden="true"><span className="active" /><span /><span /><span /></div>
        </div>
      </section>
      <section className="mobile-metrics" aria-label="Odesseus highlights">
        <article><strong className="orange-text">500K+</strong><span>Applicants</span></article>
        <article><strong className="purple-text">100K+</strong><span>Hires</span></article>
        <article><strong className="cyan-text">10+</strong><span>Countries</span></article>
        <article><strong className="lime-text">95%</strong><span>Satisfaction</span></article>
      </section>
      <section className="mobile-marketing-section">
        <p className="mobile-kicker">ODESSEUS AGENTS</p>
        <h2>Your career workflow, connected.</h2>
        <div className="mobile-agent-grid">
          <Link href="/match" className="mobile-agent-card lavender"><strong>Match</strong><span>See how well a role fits your experience.</span></Link>
          <Link href="/resume" className="mobile-agent-card peach"><strong>Resume</strong><span>Optimize your existing resume for the role.</span></Link>
          <Link href="/applications" className="mobile-agent-card cyan-card"><strong>Apply</strong><span>Approve before Odesseus submits supported applications.</span></Link>
          <Link href="/interviews" className="mobile-agent-card green-card"><strong>Prep</strong><span>Practice from your resume, role, and application history.</span></Link>
        </div>
      </section>
      <section className="mobile-marketing-section mobile-employer-card">
        <p className="mobile-kicker">ODESSEUS LIVE</p>
        <h2>Live interview support stays on desktop.</h2>
        <p>Prepare on mobile, then use Odesseus Live from your computer when the interview begins.</p>
        <Link href="/pricing">View pricing →</Link>
      </section>
      <section className="mobile-price-strip" aria-label="Pricing highlights">
        <div><small>Application Agent</small><strong>$0.99</strong><span>per successful application</span></div>
        <div><small>Interview Prep</small><strong>FREE</strong><span>role-specific preparation</span></div>
        <div><small>Odesseus Live</small><strong>$24.99</strong><span>per live interview · desktop only</span></div>
      </section>
      <div className="mobile-login-row"><Link href="/login">Sign In</Link><Link href="/signup">Sign Up</Link></div>
    </div>
  );
}
