import MarketingNav from "@/components/marketing-nav";
import MarketingFooter from "@/components/marketing-footer";
import MobileScreen from "@/components/mobile/mobile-screen";

const faqs=[
 ["Does Odesseus require a subscription?","No. Standard Apply ($0.49) and Smart Apply ($1.99) are charged from your wallet only after a successful application submission."],
 ["Does Odesseus read my email?","No. Candidate inbox access is not required."],
 ["How does the wallet work?","Add $10, $20, or $50 to your wallet. Money stays there until Odesseus successfully submits an application — no fixed credit packs."],
 ["Is Prep Agent free?","Yes. Role-specific interview preparation is free."],
 ["Can I target jobs in other countries?","Yes. Odesseus is being designed for multi-country job preferences."],
];
export default function AboutPage(){return <>
<main className="figma-site figma-soft-page odesseus-desktop-only"><div className="figma-page-wrap"><MarketingNav/><section className="figma-page-hero"><span className="figma-eyebrow">ABOUT ODESSEUS</span><h1>Career technology built around real workflows.</h1><p>Odesseus connects job discovery, applications, and interview preparation in one experience.</p></section><section className="figma-two-grid"><article className="figma-info-card lavender"><h2>Who we help</h2><p>Job seekers pursuing opportunities across career stages, industries and global markets.</p></article><article className="figma-info-card navy"><h2>Who we are</h2><p>A US-based team building practical AI tools for the modern job search.</p></article></section><section className="figma-three-grid"><article className="figma-info-card peach"><h2>User approval</h2><p>Important actions are designed around review and approval.</p></article><article className="figma-info-card cyan"><h2>Global direction</h2><p>Location, language, currency and work preferences are part of the foundation.</p></article><article className="figma-info-card green"><h2>ProcessPilot</h2><p>Developed by ProcessPilot Technologies LLC.</p></article></section><section id="faq" className="figma-faq"><span className="figma-eyebrow">FAQ</span><h2>Questions, answered simply.</h2><div className="figma-two-grid">{faqs.map(([q,a])=><article key={q}><h3>{q}</h3><p>{a}</p></article>)}</div></section></div><MarketingFooter/></main>

<MobileScreen index="29" title="About Odesseus.ai" lead="Your AI career and application platform." minHeight={1114}>
  <div className="m-list">
    <div className="m-card"><span className="m-copy"><strong>What Odesseus does</strong><small>Discover opportunities, qualify job fit, strengthen your resume, submit approved applications, track progress and prepare for interviews.</small></span></div>
    <div className="m-card"><span className="m-copy"><strong>Who we help</strong><small>Job seekers pursuing opportunities across career stages, industries and global markets.</small></span></div>
    <div className="m-card"><span className="m-copy"><strong>Who we are</strong><small>A US-based team building practical AI tools for the modern job search.</small></span></div>
    <div className="m-card"><span className="m-copy"><strong>Built for careers everywhere</strong><small>Location, language, currency and work preferences are part of the foundation.</small></span></div>
  </div>
  <div className="m-splash-footer" style={{ marginTop: 20, color: "var(--m-ink)" }}>
    <strong>Odesseus.ai</strong>
    <span style={{ color: "var(--m-muted)" }}>Version 1.0 · Career agents built around your approval.</span>
  </div>
</MobileScreen>
</>}
