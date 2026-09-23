import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const next = url.searchParams.get("next") || "/onboarding";

  if (!code) {
    return NextResponse.redirect(new URL("/signup?error=Google%20sign-in%20could%20not%20be%20completed.", request.url));
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);

  if (error) {
    return NextResponse.redirect(new URL(`/signup?error=${encodeURIComponent(error.message)}`, request.url));
  }

  const safeNext = next.startsWith("/") ? next : "/onboarding";
  return NextResponse.redirect(new URL(safeNext, request.url));
}
