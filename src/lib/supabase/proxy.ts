import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import type { Database } from "@/types/database";
import { publicSupabaseUrl, publicSupabasePublishableKey } from "@/lib/supabase/public-config";

const publicExactPaths = [
  "/",
  "/login",
  "/signup",
  "/check-email",
  "/how-it-works",
  "/apply",
  "/live",
  "/pricing",
  "/about",
  "/terms",
  "/privacy",
  "/employers",
  "/employers/pricing",
  "/employers/login",
  "/employers/signup",
  "/employers/post-job",
  "/partners",
  "/partners/apply",
  "/partners/terms",
  "/preview/job-showcase",
];
const publicPrefixPaths = ["/auth", "/api/partners", "/api/referrals"];

export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient<Database>(
    publicSupabaseUrl,
    publicSupabasePublishableKey,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet, headers) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );

          response = NextResponse.next({ request });

          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          );

          Object.entries(headers).forEach(([key, value]) =>
            response.headers.set(key, value)
          );
        },
      },
    }
  );

  const { data } = await supabase.auth.getClaims();
  const isPublic =
    publicExactPaths.includes(request.nextUrl.pathname) ||
    publicPrefixPaths.some((path) => request.nextUrl.pathname.startsWith(path + "/"));

  if (!data?.claims && !isPublic) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }

  return response;
}
