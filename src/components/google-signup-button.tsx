"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export default function GoogleSignupButton() {
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  async function continueWithGoogle() {
    setLoading(true);
    const supabase = createClient();
    const redirectTo = `${window.location.origin}/auth/callback?next=/onboarding`;

    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo,
        scopes: "openid email profile",
        queryParams: {
          prompt: "select_account",
        },
      },
    });

    if (error) {
      router.push(`/signup?error=${encodeURIComponent(error.message)}`);
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
