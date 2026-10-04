import { type EmailOtpType } from "@supabase/supabase-js";
import { type NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

function safeNext(request: NextRequest, value: string | null) {
  if (!value) return new URL("/onboarding", request.url);

  try {
    const candidate = new URL(value, request.url);
    const current = new URL(request.url);

    if (candidate.origin !== current.origin) {
      return new URL("/onboarding", request.url);
    }

    return candidate;
  } catch {
    return new URL("/onboarding", request.url);
  }
}

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const tokenHash = url.searchParams.get("token_hash");
  const type = url.searchParams.get("type") as EmailOtpType | null;
  const next = safeNext(request, url.searchParams.get("next"));

  if (tokenHash && type) {
    const supabase = await createClient();
    const { error } = await supabase.auth.verifyOtp({
      type,
      token_hash: tokenHash,
    });

    if (!error) {
      return NextResponse.redirect(next);
    }
  }

  return NextResponse.redirect(
    new URL(
      "/login?error=That%20confirmation%20link%20could%20not%20be%20verified.",
      request.url
    )
  );
}
