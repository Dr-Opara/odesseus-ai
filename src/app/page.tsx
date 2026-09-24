import Link from "next/link";
import MarketingNav from "@/components/marketing-nav";
import MarketingFooter from "@/components/marketing-footer";

const steps = [
  ["01","Find","AI-powered job matching"],
  ["02","Tailor","Resume optimization"],
  ["03","Apply","Application Agent"],
  ["04","Prepare","Free Prep Agent"],
  ["05","Interview","Walk in fully prepared"],
];

const products = [
  ["Match Agent","Understand fit before you apply.","lavender"],
  ["Resume Agent","Tailor without changing your master resume.","green"],
  ["Application Agent","Submit approved applications with AI.","orange"],
  ["Prep Agent","Practice for the exact role — free.","cyan"],
];

export default function Home() {
  return (
    <main className="figma-site">
      <section className="figma-home-shell odesseus-desktop-only">
        <div className="figma-home-hero">
          <MarketingNav inverse />
          <div className="figma-hero-grid">
            <div className="figma-hero-copy">
              <span className="figma-eyebrow">YOUR AI CAREER AGENT</span>
              <h1>Discover Your Dream Job with Odesseus.ai</h1>
              <p>Find better-fit roles, tailor your resume, apply with approval, and prepare for interviews — all in one place.</p>
              <div className="figma-actions"><Link className="figma-btn figma-btn-orange" href="/signup">Start Finding Jobs</Link><Link className="figma-link-light" href="/employers">For Employers →</Link></div>
            </div>
            <div className="figma-job-stack" aria-label="Live job match examples">
              <article className="figma-job-card card-orange"><small>Your match target</small><h3>Roles that clear the bar</h3><strong>85%+</strong><span>Scored from your resume</span></article>
              <article className="figma-job-card card-purple"><small>Resume Agent</small><h3>Tailored from your master</h3><strong>Verified</strong><span>Your facts only</span></article>
              <article className="figma-job-card card-cyan"><small>Application Agent</small><h3>Submitted with your approval</h3><strong>$0.99</strong><span>After verified submission</span></article>
              <div className="figma-live-label">YOUR SEARCH • SCORED AND UPDATED FOR YOU</div>
            </div>
          </div>
        </div>

        <div className="figma-metrics">
          <div><strong className="orange">500K+</strong><span>Applicants</span></div>
          <div><strong className="purple">100K+</strong><span>Hires</span></div>
          <div><strong className="cyan">20+</strong><span>Countries</span></div>
          <div><strong className="lime">95%</strong><span>Satisfaction</span></div>
        </div>

        <section className="figma-section figma-workflow">
          <span className="figma-eyebrow purple">ONE CAREER WORKFLOW</span>
          <h2>From job discovery to interview day.</h2>
          <div className="figma-step-grid">{steps.map(([n,title,copy])=><article key={n}><span>{n}</span><h3>{title}</h3><p>{copy}</p></article>)}</div>
        </section>

        <section className="figma-section figma-product-section">
          <span className="figma-eyebrow">BUILT AROUND YOUR ENTIRE SEARCH</span>
          <h2>One AI career platform. Five powerful agents.</h2>
          <div className="figma-product-grid">{products.map(([title,copy,tone])=><article className={`figma-product-card ${tone}`} key={title}><h3>{title}</h3><p>{copy}</p></article>)}</div>
        </section>

        <section className="figma-section figma-global">
          <div><span className="figma-eyebrow cyan">GLOBAL BY DESIGN</span><h2>Your career search doesn&apos;t stop at borders.</h2><p>Choose where you want to work, plus your language, currency and time zone. Odesseus supports a global job search.</p></div>
          <div className="figma-location-grid">{["Lagos, Nigeria","London, UK","Toronto, Canada","Austin, USA","Dubai, UAE","Istanbul, Türkiye"].map(x=><span key={x}>{x}</span>)}</div>
        </section>

        <section className="figma-section figma-employer-band">
          <div><span className="figma-eyebrow">FOR EMPLOYERS</span><h2>Find stronger candidates with less busywork.</h2><p>Post roles, review applicants, manage your pipeline and use AI-assisted matching with company verification.</p><Link href="/employers">Explore Odesseus for Employers →</Link></div>
          <div className="figma-hiring-preview"><h3>Hiring overview</h3><div><strong>12</strong><span>New applicants</span></div><div><strong>8</strong><span>Strong matches</span></div><div><strong>3</strong><span>Interviews</span></div></div>
        </section>

        <section className="figma-section figma-price-preview">
          <span className="figma-eyebrow">PAY FOR WHAT YOU USE</span><h2>Simple candidate pricing.</h2>
          <div className="figma-price-grid"><article><span>Applications</span><strong>$0.99</strong><p>per successful application</p></article><article><span>Prep Agent</span><strong>FREE</strong><p>role-specific preparation</p></article></div>
          <Link className="figma-text-cta" href="/pricing">See full pricing →</Link>
        </section>
      </section>
      <div className="odesseus-desktop-only"><MarketingFooter /></div>
    </main>
  );
}
