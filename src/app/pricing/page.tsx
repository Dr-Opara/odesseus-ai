import Link from "next/link";
import MarketingNav from "@/components/marketing-nav";
import MarketingFooter from "@/components/marketing-footer";
import MobileScreen from "@/components/mobile/mobile-screen";

const appPacks=[["25 credits","$20"],["50 credits","$35"],["100 credits","$59"]];
export default function PricingPage(){
 return <>
 <main className="figma-site figma-soft-page odesseus-desktop-only"><div className="figma-page-wrap"><MarketingNav/><section className="figma-page-hero"><span className="figma-eyebrow">PRICING</span><h1>Flexible pricing for candidates and employers.</h1><p>Choose what you need without forcing every user into the same plan.</p></section><section className="figma-three-grid"><article className="figma-price-card"><strong>$0.99</strong><p>Per successfully submitted application.</p></article><article className="figma-price-card green"><strong>FREE</strong><p>Prep Agent interview preparation.</p></article><article className="figma-price-card lavender"><strong>Included</strong><p>Application tracking and status updates.</p></article></section><section className="figma-three-grid compact">{appPacks.map(([n,p])=><article className="figma-price-card" key={n}><strong>{n} — {p}</strong><p>Candidate application credits never expire.</p></article>)}</section><p className="figma-price-note">Localized market pricing can be shown based on account or billing region.</p><Link className="figma-text-cta" href="/signup">Get Started →</Link></div><MarketingFooter/></main>

 <MobileScreen index="30" title="Pricing" lead="Pay for what you use. Prep is free." minHeight={1040}>
   <div className="m-list">
     <div className="m-card"><span className="m-copy"><strong>APPLICATION AGENT · $0.99</strong><small>per verified successful submission</small></span></div>
     {appPacks.map(([n,p])=>(
       <div className="m-card" key={n}><span className="m-copy"><strong>{n}</strong><small>{p} · never expire</small></span></div>
     ))}
     <div className="m-card"><span className="m-copy"><strong>Interview preparation · FREE</strong><small>Role-based questions, STAR stories and technical prep</small></span></div>
     <div className="m-card"><span className="m-copy"><strong>Application tracking</strong><small>Included with every account</small></span></div>
   </div>
   <p className="m-note">Localized market pricing can be shown based on account or billing region.</p>
   <Link className="m-action" style={{ display: "block", textAlign: "center", textDecoration: "none" }} href="/signup">Get Started →</Link>
 </MobileScreen>
 </>
}
