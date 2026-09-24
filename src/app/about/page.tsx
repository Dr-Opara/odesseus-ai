import MarketingNav from "@/components/marketing-nav";
import MarketingFooter from "@/components/marketing-footer";

const faqs=[
 ["Does Odesseus require a subscription?","No. Candidate application credits are purchased as you use them."],
 ["Does Odesseus read my email?","No. Candidate inbox access is not required."],
 ["Do application credits expire?","No. Candidate application credits remain available until used."],
 ["Is Prep Agent free?","Yes. Role-specific interview preparation is free."],
 ["Can I target jobs in other countries?","Yes. Odesseus is being designed for multi-country job preferences."],
];
export default function AboutPage(){return <main className="figma-site figma-soft-page"><div className="figma-page-wrap"><MarketingNav/><section className="figma-page-hero"><span className="figma-eyebrow">ABOUT ODESSEUS</span><h1>Career technology built around real workflows.</h1><p>Odesseus connects job discovery, applications, and interview preparation in one experience.</p></section><section className="figma-two-grid"><article className="figma-info-card lavender"><h2>Who we help</h2><p>Job seekers pursuing opportunities across career stages, industries and global markets.</p></article><article className="figma-info-card navy"><h2>Who we are</h2><p>A US-based team building practical AI tools for the modern job search.</p></article></section><section className="figma-three-grid"><article className="figma-info-card peach"><h2>User approval</h2><p>Important actions are designed around review and approval.</p></article><article className="figma-info-card cyan"><h2>Global direction</h2><p>Location, language, currency and work preferences are part of the foundation.</p></article><article className="figma-info-card green"><h2>ProcessPilot</h2><p>Developed by ProcessPilot Technologies LLC.</p></article></section><section id="faq" className="figma-faq"><span className="figma-eyebrow">FAQ</span><h2>Questions, answered simply.</h2><div className="figma-two-grid">{faqs.map(([q,a])=><article key={q}><h3>{q}</h3><p>{a}</p></article>)}</div></section></div><MarketingFooter/></main>}
