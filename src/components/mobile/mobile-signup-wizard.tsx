"use client";

import { FormEvent, useState } from "react";
import Link from "next/link";
import { signup } from "@/app/login/actions";
import GoogleSignupButton from "@/components/google-signup-button";
import MobileOnboardingProgress from "@/components/mobile/mobile-onboarding-progress";

/**
 * Mobile Sign Up (screen 01) + Your Name (screen 02).
 *
 * Splits the desktop's single-page signup form into the Figma mobile flow
 * without changing what gets submitted: both steps live in one `<form
 * action={signup}>`, with step 1's email/password carried forward as hidden
 * inputs. The real `signup` server action only ever runs once, on step 2's
 * submit, with the exact same fields the desktop form sends today.
 */
export default function MobileSignupWizard({ error }: { error?: string }) {
  const [step, setStep] = useState<1 | 2>(1);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [stepError, setStepError] = useState("");

  function continueToName(event: FormEvent) {
    event.preventDefault();
    if (!email || password.length < 8) {
      setStepError("Enter your email and a password of at least 8 characters.");
      return;
    }
    setStepError("");
    setStep(2);
  }

  if (step === 2) {
    return (
      <main className="odesseus-mobile-only m-screen m-screen-02">
        <span className="m-onboarding-orb" aria-hidden="true" />
        <header className="m-screen-header">
          <button type="button" onClick={() => setStep(1)} aria-label="Back">
            ←
          </button>
          <h1>
            <span>What should we call you?</span>
          </h1>
        </header>
        <MobileOnboardingProgress step={2} />
        <p className="m-lead">Tell us your name. You can change this later.</p>

        <form action={signup} className="m-signup-form">
          <input type="hidden" name="email" value={email} />
          <input type="hidden" name="password" value={password} />
          <label className="m-field">
            <span>First name</span>
            <input
              className="m-input"
              name="first_name"
              required
              placeholder="Jane"
              autoComplete="given-name"
            />
          </label>
          <label className="m-field">
            <span>Last name</span>
            <input
              className="m-input"
              name="last_name"
              required
              placeholder="Doe"
              autoComplete="family-name"
            />
          </label>
          {error ? <p className="m-inline-error">{decodeURIComponent(error)}</p> : null}
          <button className="m-action" type="submit">
            Continue →
          </button>
        </form>
      </main>
    );
  }

  return (
    <main className="odesseus-mobile-only m-screen m-screen-01">
      <span className="m-onboarding-orb m-onboarding-orb-tr" aria-hidden="true" />
      <header className="m-screen-header">
        <Link href="/" aria-label="Back">
          ←
        </Link>
        <h1>
          <span>Create your account</span>
        </h1>
      </header>
      <p className="m-lead">Join thousands finding better opportunities with AI.</p>

      <div className="m-trust-row">
        <span>10K+ resumes optimized</span>
        <span>3.4× more interviews</span>
        <span>From $0.49 per application</span>
      </div>

      <div className="m-match-preview-card">
        <span className="m-match-preview-label">AI MATCH PREVIEW</span>
        <strong>94%</strong>
        <span className="m-match-preview-copy">
          Average match improvement — Odesseus tailors the resume you already have; it never invents experience.
        </span>
      </div>

      <div className="m-signup-steps">
        <div>
          <b>1</b>
          <span>Upload resume</span>
        </div>
        <div>
          <b>2</b>
          <span>Get matched</span>
        </div>
        <div>
          <b>3</b>
          <span>Apply with confidence</span>
        </div>
      </div>

      <GoogleSignupButton />

      <div className="m-or-divider">
        <span />
        <b>OR</b>
        <span />
      </div>

      <form onSubmit={continueToName} className="m-signup-form">
        <label className="m-field">
          <span>Email</span>
          <input
            className="m-input"
            type="email"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="you@example.com"
            autoComplete="email"
          />
        </label>
        <label className="m-field">
          <span>Password</span>
          <input
            className="m-input"
            type="password"
            required
            minLength={8}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            placeholder="••••••••"
            autoComplete="new-password"
          />
        </label>
        {stepError ? <p className="m-inline-error">{stepError}</p> : null}
        {error && !stepError ? (
          <p className="m-inline-error">{decodeURIComponent(error)}</p>
        ) : null}
        <button className="m-action" type="submit">
          Continue with Email
        </button>
      </form>

      <p className="m-legal-copy">
        By continuing, you agree to our <Link href="/terms">Terms of Service</Link> and{" "}
        <Link href="/privacy">Privacy Policy</Link>.
      </p>
    </main>
  );
}
