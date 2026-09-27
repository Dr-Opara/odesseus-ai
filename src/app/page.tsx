import Link from "next/link";
import MarketingNav from "@/components/marketing-nav";
import MarketingFooter from "@/components/marketing-footer";

const steps = [
  ["01","Find","AI-powered job matching"],
  ["02","Optimize","Optimize your existing resume"],
  ["03","Apply","Choose Apply or Smart Apply"],
  ["04","Prepare","Free Prep Agent"],
  ["05","Interview","Walk in fully prepared"],
];

const products = [
  ["Match Agent","Understand fit before you apply.","lavender"],
  ["Resume Optimizer","Optimize your existing resume for the role without inventing experience.","green"],
  ["Application Agent","Apply for $0.39 or choose Smart Apply for $0.99 with job-specific optimization.","orange"],
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
              <p>Find matched roles, optimize the resume you already have, choose Apply or Smart Apply, track every application, and prepare for interviews.</p>
              <div className="figma-actions"><Link className="figma-btn figma-btn-orange" href="/signup">Start Finding Jobs</Link><Link className="figma-link-light" href="/employers">For Employers →</Link></div>
            </div>
            <div className="figma-job-stack" aria-label="Live job match examples">
              <article className="figma-job-card card-orange"><small>Microsoft</small><h3>GenAI Security Engineer</h3><strong>92% Match</strong><span>Full time • Remote</span></article>
              <article className="figma-job-card card-purple"><small>OpenAI</small><h3>AI Security Engineer</h3><strong>89% Match</strong><span>Full time • Hybrid</span></article>
              <article className="figma-job-card card-cyan"><small>Stripe</small><h3>Senior AI Engineer</h3><strong>86% Match</strong><span>Full time • Remote</span></article>
              <div className="figma-live-label">JOB MATCHES • PERSONALIZED FOR YOU</div>
            </div>
          </div>
        </div>

        <section className="figma-section figma-workflow">
          <span className="figma-eyebrow purple">ONE CAREER WORKFLOW</span>
          <h2>From job discovery to interview day.</h2>
          <div className="figma-step-grid">{steps.map(([n,title,copy])=><article key={n}><span>{n}</span><h3>{title}</h3><p>{copy}</p></article>)}</div>
        </section>

        <section className="figma-section figma-product-section">
          <span className="figma-eyebrow">BUILT AROUND YOUR ENTIRE SEARCH</span>
          <h2>One AI career platform. Four powerful agents.</h2>
          <div className="figma-product-grid">{products.map(([title,copy,tone])=><article className={`figma-product-card ${tone}`} key={title}><h3>{title}</h3><p>{copy}</p></article>)}</div>
          <article className="figma-product-card lavender" style={{ marginTop: 18 }}>
            <h3>Earn with Odesseus</h3>
            <p>Your job search can pay you back. Eligible annual members can share premium interview access with up to 10 unique friends.</p>
            <Link className="figma-text-cta" href="/earn">See earning options →</Link>
          </article>
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
          <div className="figma-price-grid">
            <article><span>Apply</span><strong>$0.39</strong><p>Use your existing approved resume. Charged only after a successful submission.</p></article>
            <article><span>Smart Apply</span><strong>$0.99</strong><p>JD analysis, best-resume selection, optimization, answers, and submission.</p></article>
            <article><span>Interview Prep</span><strong>Free</strong><p>Role-specific preparation using the exact job and resume you applied with.</p></article>
          </div>
          <p className="figma-price-note" style={{ marginLeft: 0 }}>Applications are paid from a prepaid Odesseus Wallet, so you do not get a separate card charge for every submission.</p>
          <Link className="figma-text-cta" href="/pricing">See full pricing →</Link>
        </section>
      </section>
      <div className="odesseus-desktop-only"><MarketingFooter /></div>
    </main>
  );
}
