import type { Metadata } from "next";
import Link from "next/link";
import MarketingNav from "@/components/marketing-nav";
import MarketingFooter from "@/components/marketing-footer";

export const metadata: Metadata = {
  title: "Odysseus Live — $24.99 per interview",
  description: "Go into your interview with your entire application behind you. One interview. One pass. Everything included.",
};

const compatiblePlatforms = [
  { name: "Zoom", mono: "Z" },
  { name: "Microsoft Teams", mono: "MT" },
  { name: "Google Meet", mono: "GM" },
  { name: "Webex", mono: "W" },
  { name: "Lark", mono: "L" },
  { name: "Amazon Chime", mono: "AC" },
  { name: "CoderPad", mono: "CP" },
  { name: "HackerRank", mono: "HR" },
];

export default function LivePage() {
  return (
    <main className="marketing">
      <div className="shell" style={{ paddingTop: 16 }}>
        <MarketingNav />
      </div>

      <section className="shell page-hero">
        <div className="badge">$24.99 · Odysseus Live</div>
        <h1 className="font-display page-hero-headline">Go into your interview with your entire application behind you.</h1>
        <p className="muted page-hero-copy">
          The resume you submitted, the job you applied to, and everything Odysseus prepared — all in one place when it matters.
        </p>
        <div className="hero-ctas" style={{ marginTop: 26 }}>
          <Link className="btn btn-primary" href="/signup">Get Started Free →</Link>
        </div>
      </section>

      <section className="shell" style={{ padding: "10px 0 20px" }}>
        <div className="card stage-band">
          <span className="stage-band-label">Before — Free</span>
          <h2 style={{ fontSize: 22, margin: "16px 0 4px" }}>Preparation costs nothing.</h2>
          <div className="stage-band-list">
            {[
              "Interview Workspace",
              "Exact submitted resume",
              "Job description",
              "Application answers",
              "Readiness brief",
              "Verified examples",
              "Questions to ask",
              "Previous-round memory",
            ].map((item) => (
              <div className="stage-band-list-item" key={item}>{item}</div>
            ))}
          </div>
          <div className="marketing-callout">You don&apos;t pay to prepare.</div>
        </div>

        <div className="card stage-band">
          <span className="stage-band-label">During — Odysseus Live</span>
          <h2 style={{ fontSize: 22, margin: "16px 0 4px" }}>Private, real-time support while you speak.</h2>
          <div className="stage-band-list">
            {[
              "Realtime transcription",
              "Question detection",
              "Grounded answer guidance",
              "STAR",
              "Shorter",
              "More Technical",
              "Follow-Up",
              "Recent transcript",
              "Current/prior-round context",
            ].map((item) => (
              <div className="stage-band-list-item" key={item}>{item}</div>
            ))}
          </div>
          <div className="marketing-callout">
            The candidate remains the speaker. Odysseus provides private on-screen support for recall, structure, and context.
          </div>
        </div>
      </section>

      <section className="shell" style={{ padding: "10px 0 20px" }}>
        <div className="card" style={{ padding: 34 }}>
          <h2 style={{ fontSize: 24, margin: "0 0 8px" }}>Works with the tools your interviews already use</h2>
          <p className="muted" style={{ margin: "0 0 4px", maxWidth: 620 }}>
            Odysseus Live is designed to work alongside supported video interview, technical interview, and assessment platforms.
          </p>

          <div className="platform-compat-scroll">
            {compatiblePlatforms.map((platform) => (
              <div className="platform-compat-card" key={platform.name}>
                <div className="platform-compat-mono">{platform.mono}</div>
                <div className="platform-compat-name">{platform.name}</div>
                <div className="platform-compat-status">Supported platform</div>
              </div>
            ))}
          </div>

          <p style={{ fontSize: 16, fontWeight: 650, margin: "24px 0 8px" }}>
            One Live experience across your interview tools.
          </p>
          <p className="muted" style={{ margin: "0 0 16px", maxWidth: 620, lineHeight: 1.6 }}>
            Odysseus can use shared interview audio or your microphone to provide realtime transcription, question detection, and contextual guidance—without joining the meeting as another participant.
          </p>
          <p className="muted" style={{ fontSize: 13, margin: 0, maxWidth: 620 }}>
            Platform compatibility may vary by browser, operating system, and the interview platform&apos;s audio-sharing permissions.
          </p>
        </div>
      </section>

      <section className="shell" style={{ padding: "10px 0 20px" }}>
        <div className="card stage-band">
          <span className="stage-band-label">After — Included</span>
          <h2 style={{ fontSize: 22, margin: "16px 0 4px" }}>Nothing from the interview is lost.</h2>
          <div className="stage-band-list">
            {[
              "Complete transcript",
              "Factual recap",
              "Questions",
              "Topics",
              "Experiences referenced",
              "Commitments",
              "Answers to strengthen",
              "Possible next-round preparation",
              "Round memory",
              "Follow-up email",
            ].map((item) => (
              <div className="stage-band-list-item" key={item}>{item}</div>
            ))}
          </div>
        </div>
      </section>

      <section className="shell" style={{ padding: "10px 0 100px" }}>
        <div className="card" style={{ padding: 34, textAlign: "center" }}>
          <div style={{ fontSize: 44, fontWeight: 800, letterSpacing: "-0.05em" }}>$24.99</div>
          <p className="muted" style={{ margin: "6px 0 18px" }}>per live interview</p>
          <h2 style={{ fontSize: 24, margin: "0 0 20px" }}>One interview. One pass. Everything included.</h2>
          <Link className="btn btn-primary" href="/signup">Get Started Free →</Link>
        </div>
      </section>

      <MarketingFooter />
    </main>
  );
}
