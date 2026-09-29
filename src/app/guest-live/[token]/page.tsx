import type { Metadata } from "next";
import LiveGuestLanding from "@/components/live/guest/live-guest-landing";

/**
 * The token-based Guest Live landing.
 *
 * A guest opens `/guest-live/<token>` with no account, no signup, and no
 * login. The token is the entire credential and the server validates it; this
 * page never decides whether a link is valid, it only renders what the
 * token-scoped route reports.
 *
 * Two things are load-bearing here beyond the obvious:
 *
 *  - **`noindex`.** A shared link is not a public page and must never appear
 *    in a search index or a link preview. The token is in the URL, so any
 *    index that captured it would be publishing a working credential.
 *  - **No owner id in the URL.** The token is 256 bits of randomness minted by
 *    the server and encodes nothing. There is no `?owner=` and no path segment
 *    for the plan holder, so a copied link, a screenshot, or a browser history
 *    entry cannot carry an identifier for the person who owns the plan.
 *
 * The token is passed to the client component and therefore appears in the
 * server-rendered payload. That is not an added exposure -- the browser
 * already has it in the address bar, and every guest request sends it anyway.
 * What matters is that the server never treats it as a display value, and that
 * no identifier *other* than the token ever reaches the URL.
 */
export const metadata: Metadata = {
  title: "Odesseus Live",
  robots: { index: false, follow: false, nocache: true },
};

export default async function GuestLivePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  return <LiveGuestLanding token={token} />;
}
