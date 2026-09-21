import type { Metadata } from "next";
import MarketingNav from "@/components/marketing-nav";
import MarketingFooter from "@/components/marketing-footer";

export const metadata: Metadata = {
  title: "How Odesseus Works — Odesseus",
  description: "Upload your existing resume, paste a job description, qualify and improve it, approve the application, then return to Odesseus when you receive an interview.",
};

const stages = [
  {
    n: "01",
    title: "Upload Your Existing Resume",
    body: "Start with the resume you already use. Odesseus does not create a resume from scratch — your uploaded resume and verified profile remain the source of truth.",
    pills: ["Your Resume Is the Source of Truth", "No Fabricated Qualifications"],
  },
  {
    n: "02",
    title: "Paste the Job Description",
    body: "The Job Match & Qualification Agent compares the role against your resume, checks hard requirements, and shows where your experience already aligns and where it does not.",
    pills: ["Match Score", "Hard Requirements", "Skills & Experience Alignment"],
  },
  {
    n: "03",
    title: "Improve & Review",
    body: "Odesseus edits your existing resume for that specific role using only supported facts. It improves wording, emphasis, ordering, and relevant keywords, then shows you the revised version and what changed.",
    pills: ["85%+ Target When Supported", "Before & After Review", "You Approve Every Version"],
  },
  {
    n: "04",
    title: "Approve & Apply",
    body: "After you approve the resume, the Application Agent uses that exact version to complete the supported application. A verified successful submission is recorded in your dashboard and costs $0.99.",
    pills: ["Approval Required", "$0.99 Successful Submission", "Failed Submission = $0"],
  },
  {
    n: "05",
    title: "Come Back When You Get an Interview",
    body: "No inbox access is required. When an employer contacts you, return to Odesseus, select the application or paste the job description, and start free interview preparation.",
    pills: ["No Email Access Required", "Free Interview Preparation", "Resume + JD Context"],
  },
  {
    n: "06",
    title: "Start Odesseus Live",
    body: "When the interview begins, Odesseus Live provides private realtime transcription, automatic question detection, and grounded on-screen answer guidance while you remain the speaker.",
    pills: ["$24.99 per Live Interview", "Realtime Guidance", "STAR / Shorter / Technical / Follow-Up"],
  },
];

export default function HowItWorksPage() {
  return (
    <main className="marketing">
      <div className="shell" style={{ paddingTop: 16 }}>
        <MarketingNav />
      </div>

      <section className="shell page-hero">
        <div className="badge">How Odesseus Works</div>
        <h1 className="font-display page-hero-headline">One connected path from job description to interview.</h1>
        <p className="muted page-hero-copy">
          Odesseus works from the resume you already have, waits for your approval before applying, and does not require access to your email.
        </p>
      </section>

      <section className="shell" style={{ padding: "10px 0 100px" }}>
        <div className="lifecycle-list">
          {stages.map((stage, index) => (
            <div className="lifecycle-item" key={stage.n}>
              <div className="lifecycle-marker">
                <span className="lifecycle-number">{stage.n}</span>
                {index < stages.length - 1 ? <span className="lifecycle-connector" /> : null}
              </div>
              <div className="card lifecycle-card">
                <h2 style={{ fontSize: 22, margin: "0 0 8px" }}>{stage.title}</h2>
                <p className="muted" style={{ lineHeight: 1.6, margin: 0 }}>{stage.body}</p>
                <div className="how-it-works-pills">
                  {stage.pills.map((pill) => (
                    <span className="how-it-works-pill" key={pill}>{pill}</span>
                  ))}
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>

      <MarketingFooter />
    </main>
  );
}
