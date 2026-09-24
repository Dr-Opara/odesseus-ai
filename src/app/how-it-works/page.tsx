import Link from "next/link";
import MarketingNav from "@/components/marketing-nav";
import MarketingFooter from "@/components/marketing-footer";

const cards=[
 ["Find better matches","Understand skills, experience, location and authorization fit before applying.","lavender"],
 ["Tailor your resume","Create a job-specific version without changing your master resume.","green"],
 ["Apply with approval","Review the application first, then let Odesseus handle supported steps.","peach"],
 ["Prepare for free","Practice likely questions, STAR stories and role-specific topics.","cyan"],
];

export default function HowItWorksPage(){
 return <main className="figma-site figma-soft-page"><div className="figma-page-wrap"><MarketingNav/><section className="figma-page-hero"><span className="figma-eyebrow">FOR JOB SEEKERS</span><h1>A smarter path from search to interview.</h1><p>Use AI where it helps while keeping approval over important career actions.</p></section><section className="figma-two-grid">{cards.map(([t,c,tone])=><article className={`figma-info-card ${tone}`} key={t}><h2>{t}</h2><p>{c}</p></article>)}</section><Link className="figma-text-cta" href="/signup">Start Finding Jobs →</Link></div><MarketingFooter/></main>
}
