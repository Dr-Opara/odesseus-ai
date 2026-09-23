"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { resolveMobileScreen, type MobileScreenSpec } from "@/lib/mobile/screen-map";

type Row = { icon?: string; title: string; sub?: string; tag?: string; href?: string };
type Content = { lead?: string; rows?: Row[]; note?: string; action?: string };

const content: Record<string, Content> = {
  "01": { lead: "Join thousands finding better opportunities with AI.", rows: [
    { title: "10K+ resumes optimized" }, { title: "3.4× more interviews" }, { title: "$0.99 per application" },
    { title: "AI MATCH PREVIEW", sub: "94% Average match improvement" },
    { title: "Continue with Google", tag: "G" }, { title: "Continue with Email", tag: "✉" }
  ], note: "By continuing, you agree to our Terms of Service and Privacy Policy." },
  "02": { lead: "Tell us your name. You can change this later.", rows: [
    { title: "First name", sub: "Emmanuel" }, { title: "Last name", sub: "Opara" }
  ], action: "Continue →" },
  "03": { lead: "Upload the resume you already use. Odesseus improves it for a specific job — it does not create one from scratch.", rows: [
    { icon: "↑", title: "Upload your resume", sub: "PDF or DOCX" }
  ], action: "Upload Resume →", note: "🔒 Your resume stays private — used only to power your matches." },
  "04": { lead: "A few preferences help Odesseus.ai keep every match relevant.", rows: [
    { title: "Target role", sub: "Senior Compliance Analyst" }, { title: "Countries", sub: "United States" },
    { title: "Work style", sub: "Remote" }, { title: "Minimum salary", sub: "$120,000" }
  ], action: "Finish Setup", note: "You can update these anytime in Settings." },
  "05": { lead: "Find better jobs with AI.", rows: [
    { title: "Senior GRC Analyst", sub: "Microsoft · $130k – $170k", tag: "96% Match", href: "/match/demo" },
    { title: "Security Compliance Engineer", sub: "Amazon · $150k – $200k", tag: "92% Match", href: "/match/demo" },
    { title: "Compliance Analyst", sub: "Flutterwave · Lagos, Nigeria · Hybrid", tag: "88% Match", href: "/match/demo" }
  ], note: "Agent Activity · Job Match Agent found 2 new roles" },
  "06": { lead: "Microsoft · GenAI Security Engineer", rows: [
    { title: "$180k – $247k", sub: "Remote — US · Full-time · 3–5 years" },
    { title: "About the role", sub: "Help secure AI platforms and infrastructure through threat modeling, security controls, and governance for generative AI systems." },
    { title: "Key requirements", sub: "5+ years cybersecurity/cloud · GenAI/LLM security · NIST/ISO 27001 · Python/PowerShell" }
  ], action: "Analyze with Odesseus →" },
  "07": { lead: "GenAI Security Engineer · Microsoft", rows: [
    { title: "94%", sub: "Great Match!", tag: "Match Score" }, { icon: "✓", title: "Core skills match", sub: "8/10" },
    { icon: "↗", title: "Skill gaps", sub: "3" }, { icon: "♧", title: "Resume improvements", sub: "AI Suggested" }
  ], action: "View Recommendations →", note: "♡ Save for later" },
  "08": { lead: "AI suggestions based on this role", rows: [
    { title: "PROFESSIONAL SUMMARY", sub: "Results-driven cybersecurity professional with 8+ years of experience securing cloud and AI/ML environments." },
    { title: "Lead Compliance Officer", sub: "IntelliDyne LLC · Implemented AI security frameworks aligned with NIST AI RMF and ISO 27001." }
  ], action: "Approve & Apply →", note: "🟢 Green highlights = AI-suggested improvements for this role" },
  "09": { lead: "You stay in control before submission.", rows: [
    { title: "Senior Compliance Analyst", sub: "Microsoft · Remote · $135K–$165K", tag: "94% match" },
    { title: "Application package", sub: "✓ Tailored resume · ✓ Contact information · ✓ Job-specific answers · ✓ Final review complete" }
  ], action: "Approve & submit · $0.99", note: "Charged only after a successful submission." },
  "10": { rows: [
    { title: "Microsoft", sub: "GenAI Security Engineer · Submitted · 2 days ago" },
    { title: "Amazon", sub: "Security Compliance Engineer · In Review · 5 days ago" },
    { title: "Cisco", sub: "FedRAMP Compliance Analyst · Interview · 1 week ago" },
    { title: "SAIC", sub: "ISSO · Draft · Not submitted" },
    { title: "Peraton", sub: "AWS Security Engineer · Rejected · 2 weeks ago" }
  ] },
  "11": { rows: [
    { icon: "◉", title: "Practice Questions", sub: "Role-specific" }, { icon: "☆", title: "STAR Story Builder", sub: "Your experience" },
    { icon: "◉", title: "Technical Topics", sub: "Skills & concepts" }, { icon: "◉", title: "Mock Interview", sub: "Real-time practice" },
    { title: "Microsoft", sub: "GenAI Security Engineer" }
  ], action: "Generate Prep Plan →" },
  "12": { lead: "Emmanuel Opara · emmanuel@odesseus.ai · Pro", rows: [
    { icon: "🎯", title: "Job Preferences", href: "/settings/job-preferences" }, { icon: "📄", title: "Documents", href: "/settings/documents" },
    { icon: "$", title: "Pricing", href: "/pricing" }, { icon: "⚙", title: "Account Settings", href: "/settings" },
    { icon: "🔔", title: "Notifications", href: "/settings/notifications" }, { icon: "🎁", title: "Refer a Friend", href: "/settings/referrals" },
    { icon: "⚖", title: "Legal", href: "/legal" }, { icon: "❓", title: "Help & Support", href: "/support" }
  ] },
  "14": { lead: "Manage your account and app experience.", rows: [
    { icon: "👤", title: "Personal Information", sub: "Name and email", href: "/profile" },
    { icon: "🔒", title: "Password & Security", sub: "Password and sign-in security", href: "/settings/security" },
    { icon: "🔔", title: "Notifications", sub: "Applications, interviews, documents", href: "/settings/notifications" },
    { icon: "🎯", title: "Job Preferences", sub: "Roles, salary, location, work type", href: "/settings/job-preferences" },
    { icon: "📄", title: "Documents", sub: "Resume and career documents", href: "/settings/documents" },
    { icon: "🌐", title: "Language & Region", sub: "Language, country and timezone", href: "/settings/language-region" },
    { icon: "🌓", title: "Appearance", sub: "Light, dark or system", href: "/settings/appearance" }
  ] },
  "15": { lead: "Protect your Odesseus account.", rows: [
    { icon: "🔑", title: "Change Password", sub: "Update your account password" }, { icon: "🔗", title: "Google Account", sub: "Connected sign-in", tag: "Connected" },
    { icon: "🛡", title: "Two-Step Verification", sub: "Add another layer of protection" }, { icon: "💻", title: "Active Sessions", sub: "Review signed-in devices" },
    { icon: "🚪", title: "Sign Out Everywhere", sub: "End all other sessions" }
  ], note: "We’ll alert you when important sign-in or account security changes occur." },
  "16": { lead: "Choose what Odesseus should notify you about.", rows: [
    { icon: "📋", title: "Application updates", sub: "Submission and status changes", tag: "On" },
    { icon: "📄", title: "Documents", sub: "Resume and document changes", tag: "On" },
    { icon: "🎯", title: "Job matches", sub: "New high-match opportunities", tag: "On" },
    { icon: "✨", title: "Agent activity", sub: "Important Odesseus Agent actions", tag: "On" },
    { icon: "🚀", title: "Product updates", sub: "New features and announcements", tag: "Off" }
  ] },
  "17": { lead: "Control how Odesseus finds and qualifies roles.", rows: [
    { icon: "🎯", title: "Target Roles", sub: "GRC, AI Security, Compliance" }, { icon: "📍", title: "Target Countries", sub: "United States, United Kingdom", href: "/settings/countries" },
    { icon: "🏠", title: "Work Arrangement", sub: "Remote preferred" }, { icon: "💰", title: "Salary Range", sub: "Set minimum and target" },
    { icon: "💼", title: "Employment Type", sub: "Full-time, contract" }, { icon: "🏢", title: "Industries", sub: "Federal, healthcare, finance" },
    { icon: "$", title: "Preferred Currency", sub: "USD ($)" }, { icon: "🌍", title: "Work Authorization", sub: "Eligibility, sponsorship, relocation", href: "/settings/work-authorization" }
  ], action: "Save preferences" },
  "18": { lead: "Manage the files your agents use.", rows: [
    { icon: "＋", title: "Upload document", sub: "PDF or DOCX" }, { icon: "📄", title: "Primary Resume", sub: "Emmanuel_Opara_Resume.pdf" },
    { icon: "✉", title: "Cover Letter", sub: "Default_Cover_Letter.docx" }, { icon: "🎓", title: "Certification List", sub: "Certifications.pdf" }
  ], note: "Odesseus uses only the documents you choose for job matching, tailoring and interview preparation." },
  "19": { lead: "Set language and regional formatting.", rows: [
    { icon: "🌐", title: "Language", sub: "English (US)" }, { icon: "📍", title: "Region", sub: "United States" },
    { icon: "🕐", title: "Time Zone", sub: "Central Time" }, { icon: "📅", title: "Date Format", sub: "MM/DD/YYYY" }, { icon: "💵", title: "Currency", sub: "USD ($)" }
  ] },
  "20": { lead: "Choose how Odesseus looks on this device.", rows: [
    { icon: "☀", title: "Light", sub: "Bright background", tag: "✓" }, { icon: "🌙", title: "Dark", sub: "Dark interface" }, { icon: "⚙", title: "System", sub: "Match device setting" }
  ] },
  "21": { lead: "Help someone discover a smarter way to manage their job search.", rows: [
    { icon: "↗", title: "Share Odesseus.ai", sub: "Invite friends with your personal referral link." },
    { title: "odesseus.ai/r/emmanuel", tag: "Copy" }, { title: "0 Invited", sub: "0 Joined · Rewards coming soon" }
  ], action: "Share referral link" },
  "22": { lead: "Policies and product information.", rows: [
    { icon: "📜", title: "Terms of Service", sub: "Rules for using Odesseus.ai", href: "/terms" },
    { icon: "🔒", title: "Privacy Policy", sub: "How information is handled", href: "/privacy" },
    { icon: "♿", title: "Accessibility Statement", sub: "Our accessibility commitment", href: "/accessibility" },
    { icon: "📦", title: "Open-Source Licenses", sub: "Third-party software notices", href: "/licenses" },
    { icon: "ℹ", title: "About Odesseus.ai", sub: "Product and company information", href: "/about" }
  ] },
  "23": { lead: "Effective date: September 21, 2026", rows: [
    { title: "Using Odesseus.ai", sub: "These terms govern access to and use of Odesseus.ai services. Users are responsible for information they submit and for reviewing actions requiring approval." },
    { title: "AI-assisted services", sub: "Review generated resumes, application responses and interview-preparation content before relying on them." },
    { title: "Applications & payments", sub: "Paid services are subject to the pricing and confirmation shown before purchase." },
    { title: "Account responsibilities", sub: "Keep credentials secure and use the service in accordance with applicable law." }
  ], note: "Full legal copy should be reviewed by counsel before launch." },
  "24": { lead: "A clear view of how Odesseus uses data.", rows: [
    { title: "Information you provide", sub: "Account details, resumes, career preferences, job information and other content you choose to provide." },
    { title: "How it is used", sub: "Job matching, resume assistance, applications, interview preparation and account functionality." },
    { title: "Your controls", sub: "Manage documents, preferences and account information from Account Settings." },
    { title: "Security & retention", sub: "Safeguards are designed to protect account information and data is retained according to applicable policies." }
  ], note: "Detailed production policy requires legal/privacy review." },
  "25": { lead: "Our commitment to an inclusive Odesseus experience.", rows: [
    { icon: "♿", title: "Designed for more people", sub: "Usable across different abilities, devices and assistive technologies." },
    { title: "Our approach", sub: "Readable contrast, scalable text, keyboard navigation, meaningful labels and assistive technology compatibility." },
    { title: "Feedback", sub: "Contact support if you experience an accessibility barrier." }
  ], action: "Contact Accessibility Support" },
  "26": { lead: "Third-party software used by Odesseus.ai.", rows: [
    { icon: "📦", title: "Open-source software", sub: "Applicable packages, copyright notices and license terms used in the app." },
    { title: "Package name", sub: "License type" }, { title: "Package name", sub: "License type" }, { title: "Package name", sub: "License type" }
  ], note: "Populate this list from the production dependency inventory before release." },
  "27": { lead: "Quick answers about Odesseus.ai.", rows: [
    "How does job matching work?","Does Odesseus apply without my approval?","How does resume optimization work?","What does an application cost?","Where is Odesseus Live available?","How do I manage my documents?"
  ].map((title) => ({ title, tag: "＋" })) },
  "28": { lead: "Get help with your account or Odesseus services.", rows: [
    { icon: "💬", title: "Contact Support", sub: "Send a message to the Odesseus team" }, { icon: "⚠", title: "Report a Problem", sub: "Tell us when something isn’t working" },
    { icon: "💳", title: "Billing Support", sub: "Questions about charges or payments" }, { icon: "♿", title: "Accessibility Support", sub: "Report an accessibility issue" },
    { icon: "❓", title: "FAQ", sub: "Browse common questions", href: "/faq" }
  ] },
  "29": { lead: "Your AI career and application platform.", rows: [
    { title: "What Odesseus does", sub: "Discover opportunities, qualify job fit, strengthen your resume, submit approved applications, track progress and prepare for interviews." },
    { title: "Odesseus Live", sub: "Live interview assistance is designed for desktop while mobile provides preparation and history." },
    { title: "Who we help", sub: "Job seekers at every career stage, including international, remote and relocation candidates." },
    { title: "Built for careers everywhere", sub: "Careers don’t stop at borders. Neither should your career tools." }
  ], note: "Version 1.0 · Career agents built around your approval." },
  "30": { lead: "Pay for what you use. Prep is free.", rows: [
    { title: "APPLICATION AGENT · $0.99", sub: "per verified successful submission" },
    { title: "Application credit packs", sub: "25 credits · $20 · 50 credits · $35 · 100 credits · $59" },
    { title: "Interview preparation · FREE", sub: "Role-based questions, STAR stories and technical prep" },
    { title: "ODESSEUS LIVE · WEB · $24.99", sub: "per live interview" },
    { title: "3 Live passes · $59.99", sub: "No expiration" }, { title: "Annual Live · $499/year", sub: "12 months of Live access" }
  ], note: "Odesseus Live is desktop/web only. Prep Agent and your career workspace remain available on mobile." },
  "31": { lead: "Where do you want to work?", rows: [
    ["🇺🇸","United States","✓"],["🇬🇧","United Kingdom",""],["🇨🇦","Canada",""],["🇦🇺","Australia",""],["🇧🇷","Brazil",""],["🇫🇷","France",""],["🇩🇪","Germany",""],["🇬🇭","Ghana",""],["🇮🇳","India",""],["🇰🇪","Kenya",""],["🇳🇬","Nigeria",""],["🇵🇭","Philippines",""],["🇿🇦","South Africa",""]
  ].map(([icon,title,tag]) => ({ icon, title, tag })), action: "Apply (1 selected)" },
  "32": { lead: "Self-reported by you — Odesseus does not make legal work-authorization determinations.", rows: [
    { icon: "🌍", title: "Authorized to work in", sub: "United States · United Kingdom" }, { title: "Require employer sponsorship?", sub: "No" }, { title: "Open to relocation?", sub: "Depends" }
  ], action: "Save" },
  "33": { lead: "GenAI Security Engineer · Microsoft", rows: [
    "Scam","Fake Company","Misleading Job Description","Misleading Salary","Requests Payment","Phishing Attempt","Duplicate Listing","Incorrect Location","Other"
  ].map((title, i) => ({ title, tag: i === 0 ? "◉" : "○" })), action: "Submit Report", note: "Our team reviews every report. This helps keep Odesseus trustworthy for everyone." }
};

function titleFor(screen: MobileScreenSpec) {
  if (screen.index === "01") return "Create your account";
  if (screen.index === "02") return "What should we call you?";
  if (screen.index === "03") return "Start with your resume.";
  if (screen.index === "04") return "What are you looking for?";
  if (screen.index === "05") return "Hello 👋\nEmmanuel";
  return screen.name;
}

function BottomNav({ active }: { active: string }) {
  const links = [
    ["⌂","Home","/dashboard","05"],["⌕","Match","/jobs","06"],["▣","Apps","/applications","10"],["♧","Prep","/interviews","11"],["◉","Profile","/profile","12"],
  ];
  return <nav className="m-bottom-nav">{links.map(([icon,label,href,index]) => <Link className={active === index ? "active" : ""} href={href} key={index}><span>{icon}</span><small>{label}</small></Link>)}</nav>;
}

function Splash() {
  return <main className="m-splash">
    <div className="m-splash-card">
      <div className="m-stack">
        <div className="m-stack-card lime">NVIDIA</div><div className="m-stack-card pink">Amazon</div><div className="m-stack-card cyan">Google</div>
        <div className="m-stack-card orange"><b>Microsoft</b><h2>GenAI Security<br/>Engineer</h2><small>Full time · $247K</small><div><span>See Details</span><span>Next Match →</span></div></div>
      </div>
      <h1>Discover Your<br/><em>Dream Job</em><br/>with <em>Odesseus.ai</em></h1>
      <p>Find roles that fit your experience, strengthen your resume, apply with your approval, and prepare for what comes next.</p>
      <Link href="/signup" className="m-primary">Get Started <b>→</b></Link>
      <div className="m-splash-stats"><span><b>500K+</b><small>Applicants</small></span><span><b>100K+</b><small>Hires</small></span><span><b>10+</b><small>Countries</small></span><span><b>95%</b><small>Satisfaction</small></span></div>
    </div>
  </main>;
}

function Screen({ screen }: { screen: MobileScreenSpec }) {
  const c = content[screen.index] ?? {};
  const active = ["05","06","10","11","12"].includes(screen.index) ? screen.index : "";
  const isGrid = screen.index === "11";
  return <main className={"m-screen m-screen-" + screen.index} style={{ minHeight: screen.minHeight }}>
    <header className="m-screen-header">
      {screen.index !== "05" ? <button onClick={() => history.back()} aria-label="Back">←</button> : null}
      <h1>{titleFor(screen).split("\n").map((line, i) => <span key={i}>{line}</span>)}</h1>
      {screen.index === "12" ? <Link href="/settings">⚙</Link> : null}
    </header>
    {c.lead ? <p className="m-lead">{c.lead}</p> : null}
    {screen.index === "05" ? <section className="m-ai-hero"><h2>Find better jobs<br/>with AI.</h2><p>Personalized matches. Smarter applications. Real results.</p><div>⌕ Search jobs, skills, or companies… <b>≡</b></div></section> : null}
    {screen.index === "31" ? <div className="m-search">⌕ Search countries</div> : null}
    <section className={isGrid ? "m-grid" : "m-list"}>
      {c.rows?.map((row, i) => {
        const body = <><span className="m-icon">{row.icon ?? (screen.index === "10" ? row.title.slice(0,1) : "•")}</span><span className="m-copy"><strong>{row.title}</strong>{row.sub ? <small>{row.sub}</small> : null}</span>{row.tag ? <b className="m-tag">{row.tag}</b> : <b className="m-chevron">›</b>}</>;
        return row.href ? <Link className="m-card" href={row.href} key={i}>{body}</Link> : <div className="m-card" key={i}>{body}</div>;
      })}
    </section>
    {c.note ? <div className="m-note">{c.note}</div> : null}
    {c.action ? <button className="m-action">{c.action}</button> : null}
    {active ? <BottomNav active={active} /> : null}
  </main>;
}

export default function MobileRouteExperience({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const screen = resolveMobileScreen(pathname);
  if (!screen) return <>{children}</>;
  if (screen.index === "00") return <><div className="odesseus-mobile-only"><Splash /></div><div className="odesseus-desktop-only">{children}</div></>;
  if (["01","02","03","04"].includes(screen.index) && !pathname.startsWith("/mobile/")) return <>{children}</>;
  return <><div className="odesseus-mobile-only"><Screen screen={screen} /></div><div className="odesseus-desktop-only">{children}</div></>;
}
