import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import type { Database } from "@/types/database";
import { publicSupabaseUrl, publicSupabasePublishableKey } from "@/lib/supabase/public-config";
import { resolveQaMobilePath } from "@/lib/mobile/screen-map";

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
  "/robots.txt",
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
  const pathname = request.nextUrl.pathname;

  // /qa/mobile/* is a dev preview shell around the real route (rendered in an
  // iframe); it must require exactly the same session as whatever it mirrors,
  // so its auth check is delegated to the real path rather than checked
  // against the QA path itself.
  const qaMobile = pathname.startsWith("/qa/mobile")
    ? resolveQaMobilePath(pathname)
    : null;
  const effectivePathname = qaMobile?.realPath ?? pathname;

  const isPublic =
    publicExactPaths.includes(effectivePathname) ||
    publicPrefixPaths.some((path) => effectivePathname.startsWith(path + "/"));

  if (!data?.claims && !isPublic) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }

  return response;
}
