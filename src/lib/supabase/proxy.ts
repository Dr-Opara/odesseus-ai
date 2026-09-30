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
  "/careers",
  "/first-100",
  // Public homepage job feed (see src/app/api/jobs/home-feed/route.ts):
  // anonymous callers are an explicit, documented part of its contract — the
  // mobile splash reads it client-side with no server session. Without this
  // entry every anonymous request is redirected to /login before the route
  // handler ever runs, which silently breaks the public job carousel.
  "/api/jobs/home-feed",
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

/**
 * Machine-to-machine API paths that must NOT be session-redirected.
 *
 * These are called by a scheduler or a payment provider, never by a browser
 * and never with a Supabase session. Redirecting them to `/login` is a category
 * error: the request has no session to be missing, so the redirect is the only
 * answer it can ever receive. That is not a theoretical concern -- every entry
 * below was unreachable, and being unreachable is indistinguishable from being
 * broken:
 *
 *   - `/api/cron/*` is scheduled in `vercel.json`. Blocked means no job
 *     discovery, no job-feed refresh, no retry-queue processing, no
 *     notification emails, and no interview reminders.
 *   - `/api/webhooks/stripe` is where Stripe posts. Blocked means no wallet
 *     top-ups, no subscription sync, no credit grants.
 *
 * They are listed separately from `publicPrefixPaths` on purpose, because they
 * are NOT public. A `publicPrefixPaths` entry means "a signed-out browser may
 * fetch this and it will be served". These entries mean "this request is
 * authenticated by something other than a session, and the proxy has no
 * business judging it". Each route below proves that itself, and each is
 * fail-closed when its credential is absent:
 *
 *   - every `/api/cron/*` route requires
 *     `authorization: Bearer $CRON_SECRET` and, critically, returns 401 when
 *     `CRON_SECRET` is *unset* -- so a missing secret denies everyone rather
 *     than admitting everyone;
 *   - `/api/webhooks/stripe` requires a `stripe-signature` header verified
 *     against `STRIPE_WEBHOOK_SECRET` via `webhooks.constructEvent`, and
 *     rejects a missing or invalid signature before touching the database.
 *
 * So the security boundary for these paths is unchanged by this edit: it moves
 * from "unreachable" to "reachable, and refusing every caller that cannot
 * prove the shared secret or a valid provider signature". The prefixes are kept
 * tight so nothing else under `/api/cron` or `/api/webhooks` inherits that.
 */
const machineApiPrefixPaths = ["/api/cron", "/api/webhooks"];

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

  // Scheduled and provider-originated calls are exempt from the session check,
  // not because they are public but because they authenticate another way.
  // They still reach their own guard, which denies any caller that cannot prove
  // the shared secret or a valid provider signature. See
  // `machineApiPrefixPaths` for why this is a separate list.
  const isMachineApi = machineApiPrefixPaths.some((path) =>
    effectivePathname.startsWith(path + "/")
  );

  if (!data?.claims && !isPublic && !isMachineApi) {
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
