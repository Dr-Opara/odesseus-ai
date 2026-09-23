"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";

export default function GoogleSignupButton() {
  const [loading, setLoading] = useState(false);

  async function continueWithGoogle() {
    setLoading(true);
    const supabase = createClient();
    const redirectTo = `${window.location.origin}/auth/callback?next=/onboarding`;

    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo,
        queryParams: {
          access_type: "offline",
          prompt: "consent",
        },
      },
    });

    if (error) {
      window.location.href = `/signup?error=${encodeURIComponent(error.message)}`;
    }
  }

  return (
    <button
      type="button"
      onClick={continueWithGoogle}
      disabled={loading}
      className="candidate-google-button"
      aria-label="Continue with Google"
    >
      <span className="candidate-google-mark" aria-hidden="true">G</span>
      <span>{loading ? "Connecting…" : "Continue with Google"}</span>
    </button>
  );
}
