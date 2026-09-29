import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import type { Database } from "@/types/database";
import { publicSupabaseUrl, publicSupabasePublishableKey } from "@/lib/supabase/public-config";
import { resolveQaMobilePath } from "@/lib/mobile/screen-map";

const publicExactPaths = [
  "/",
  "/signin",
  "/login",
  "/signup",
  "/check-email",
  "/how-it-works",
  "/apply",
  "/live",
  "/agents",
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
  "/legal",
  "/accessibility",
  "/licenses",
  "/faq",
  "/support",
];
const publicPrefixPaths = [
  "/auth",
  "/api/partners",
  "/api/referrals",
  // Guest Live (F12). A guest has no account, no session, and no way to obtain
  // one -- that is the product. The shared link token in the URL is the entire
  // credential, and every guest route re-derives its single guest record from
  // the token's hash and authorizes itself; none of them read the caller's
  // session, and none of them would behave differently if one existed.
  //
  // The prefix is deliberately narrow. `/api/live/guest-access/...` is public;
  // `/api/live/guest-links` (minting a link) and `/api/live/entitlement` are
  // not, because those belong to a signed-in owner. And the page prefix exposes
  // only `/guest-live/<token>` and `/guest-live/<token>/analysis` -- both of
  // which render nothing until the server confirms the token.
  //
  // Without these two entries every guest request is redirected to /login,
  // which makes the product unreachable rather than merely restricted.
  "/guest-live",
  "/api/live/guest-access",
];

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
    // Any protected /employers/* path (including dynamic ones like
    // /employers/jobs/[id]) sends a signed-out visitor to the employer sign-in
    // flow, not the candidate one — this covers dynamic employer routes
    // without needing to whitelist each one individually.
    url.pathname = effectivePathname.startsWith("/employers/") ? "/employers/login" : "/login";
    return NextResponse.redirect(url);
  }

  return response;
}
