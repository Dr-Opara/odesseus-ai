"use client";

import Link from "next/link";
import { trackEventClient } from "@/lib/analytics/tracking";
import { useEffect } from "react";

export default function First100Content() {
  useEffect(() => {
    trackEventClient({ event: "first_100_page_view" });
  }, []);

  const benefits = [
    {
      icon: "\uD83D\uDCB0",
      title: "Lifetime wallet credits",
      description: "$50 wallet credit on us \u2014 covers 100+ Standard Apply submissions or 25 Smart Apply submissions. Never expires.",
    },
    {
      icon: "\uD83C\uDFAF",
      title: "Priority matching",
      description: "Your resume gets matched against new jobs first. Early access to every matching cycle.",
    },
    {
      icon: "\uD83D\uDCAC",
      title: "Direct founder access",
      description: "Private Discord channel with the founding team. Feature requests, bug reports, and roadmap input go straight to us.",
    },
    {
      icon: "\uD83D\uDE80",
      title: "Early access to every feature",
      description: "Resume tailoring, Live interview assistant, new job boards \u2014 you get it before anyone else.",
    },
    {
      icon: "\uD83C\uDFF7",
      title: "Founding member badge",
      description: "Permanent \"Founding 100\" badge on your profile and in the community. Recognition that lasts.",
    },
    {
      icon: "\uD83E\uDD1D",
      title: "Referral multiplier",
      description: "Earn 2\u00D7 referral rewards for the first year. Help friends land jobs and earn more.",
    },
  ];

  const timeline = [
    { phase: "Now", title: "Applications open", description: "Apply below. We review manually and invite in batches of 10." },
    { phase: "Week 1\u20132", title: "Onboarding & setup", description: "Resume upload, preferences, first matches. Dedicated support." },
    { phase: "Month 1", title: "First applications", description: "Start applying with wallet credits. We iterate fast based on your feedback." },
    { phase: "Ongoing", title: "Lifetime benefits", description: "Credits, priority, access \u2014 forever. You are the foundation of Odesseus." },
  ];

  return (
    <>
      <section className="shell first100-hero">
        <div className="badge">First 100 Users Campaign</div>
        <h1>Help us build the future of job search.</h1>
        <p className="first100-tagline">
          We are looking for 100 job seekers to shape Odesseus from the inside.
          In return: lifetime wallet credits, priority access, and a direct line to the team.
        </p>
        <div className="first100-spots">
          <span className="first100-count">100</span>
          <span className="first100-label">spots available</span>
        </div>
        <Link className="btn btn-primary first100-cta" href="#apply">
          Apply to join the First 100
        </Link>
        <p className="first100-note">
          No purchase required. We select for diversity of background, role, and geography.
        </p>
      </section>

      <section id="benefits" className="shell marketing-section">
        <div className="marketing-section-heading">
          <div className="badge">What you get</div>
          <h2>Benefits that last as long as you use Odesseus.</h2>
        </div>
        <div className="first100-benefits">
          {benefits.map((benefit) => (
            <article className="card first100-benefit" key={benefit.title}>
              <span className="first100-icon" aria-hidden="true">{benefit.icon}</span>
              <h3>{benefit.title}</h3>
              <p className="muted">{benefit.description}</p>
            </article>
          ))}
        </div>
      </section>

      <section id="timeline" className="shell marketing-section">
        <div className="marketing-section-heading">
          <div className="badge">How it works</div>
          <h2>From application to lifetime member.</h2>
        </div>
        <div className="first100-timeline">
          {timeline.map((item, i) => (
            <article className="first100-step" key={item.phase}>
              <div className="first100-step-marker">
                <span className="first100-step-number">{i + 1}</span>
              </div>
              <div className="first100-step-content">
                <div className="first100-step-phase">{item.phase}</div>
                <h3>{item.title}</h3>
                <p className="muted">{item.description}</p>
              </div>
            </article>
          ))}
        </div>
      </section>

      <section id="apply" className="shell marketing-section">
        <div className="marketing-section-heading">
          <div className="badge">Apply</div>
          <h2>Tell us about you.</h2>
        </div>
        <div className="card first100-form-card">
          <p className="muted first100-form-intro">
            We review every application manually. We are looking for people actively searching for roles,
            open to trying new tools, and willing to give honest feedback.
          </p>
          <form className="first100-form" action="/api/first-100/apply">
            <div className="first100-form-grid">
              <label>Full name<input className="input" name="full_name" required placeholder="Jane Doe" /></label>
              <label>Email<input className="input" name="email" type="email" required placeholder="jane@example.com" /></label>
              <label>Current role<input className="input" name="current_role" required placeholder="Senior Product Manager" /></label>
              <label>Target role<input className="input" name="target_role" required placeholder="Director of Product" /></label>
              <label>Location<input className="input" name="location" required placeholder="San Francisco, CA (or Remote)" /></label>
              <label>LinkedIn / Portfolio<input className="input" name="profile_url" type="url" placeholder="https://linkedin.com/in/..." /></label>
            </div>
            <label className="first100-textarea">Why do you want to be in the First 100?<textarea className="input" name="motivation" rows={4} required minLength={50} placeholder="What frustrates you about job search today? What would you change?" /></label>
            <label className="first100-textarea">How did you hear about Odesseus?<textarea className="input" name="source" rows={2} placeholder="Twitter, friend, newsletter, search..." /></label>
            <button className="btn btn-primary first100-submit" type="submit">
              Submit application
            </button>
            <p className="muted first100-form-footer">
              We will email you within 7 days if you are selected. Your data is never sold or shared.
            </p>
          </form>
        </div>
      </section>

      <section className="shell marketing-section">
        <div className="marketing-section-heading">
          <div className="badge">FAQ</div>
          <h2>Common questions.</h2>
        </div>
        <div className="first100-faq">
          {[
            ["Is this really free?", "Yes. No credit card. No purchase required. The $50 wallet credit is ours to give."],
            ["What if I am not selected?", "We will keep your application on file for future cohorts. You can also join the Partner Program or sign up normally."],
            ["Do I need to be a developer?", "No. We want designers, PMs, marketers, sales, ops, engineers \u2014 anyone navigating a job search."],
            ["What is the time commitment?", "Whatever you want. Use Odesseus for your job search. Give feedback when you have it. No mandatory calls."],
            ["Can I refer friends?", "Yes. First 100 members get 2\u00D7 referral rewards for the first year."],
            ["When does the wallet credit expire?", "Never. It stays in your wallet until you use it."],
          ].map(([q, a]) => (
            <details className="first100-faq-item" key={q}>
              <summary>{q}</summary>
              <p className="muted">{a}</p>
            </details>
          ))}
        </div>
      </section>

      <section className="shell partner-cta card">
        <div>
          <div className="badge">Prefer to partner?</div>
          <h2>Creator or affiliate? Join the Partner Program.</h2>
        </div>
        <Link className="btn btn-primary" href="/partners/apply">
          Apply as a Partner
        </Link>
      </section>
    </>
  );
}