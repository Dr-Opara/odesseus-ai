import Link from "next/link";
import OdesseusWordmark from "@/components/odesseus-wordmark";
import GuestLiveShell from "@/components/guest-live-shell";
import { isPlausibleGuestToken } from "@/lib/live/guest-share";

/**
 * Guest Live token landing page (F2).
 *
 * This route is intentionally no-account: no login, no signup, no payment,
 * no wallet. The link token is the whole credential, and the backend resolves
 * exactly one guest record from it. Nothing here reads an owner-scoped route,
 * so no owner profile, resume, application, wallet, billing record, or other
 * guest's session is reachable from this page.
 */

export default async function GuestLivePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const plausible = isPlausibleGuestToken(token);

  return (
    <main className="figma-site figma-soft-page guest-live-page">
      <div className="figma-page-wrap">
        <header className="figma-nav" style={{ background: "transparent", boxShadow: "none" }}>
          <div className="figma-nav-inner">
            <OdesseusWordmark href="/" size="sm" />
            <div className="figma-nav-actions">
              <span className="muted" style={{ fontSize: 13 }}>
                Guest Live
              </span>
            </div>
          </div>
        </header>

        <section style={{ width: "min(760px,100%)", margin: "40px auto 90px" }}>
          {!plausible ? (
            <div className="card" style={{ padding: 32 }}>
              <h1 style={{ fontSize: 32, margin: "0 0 10px" }}>This link isn&rsquo;t valid.</h1>
              <p className="muted" style={{ lineHeight: 1.6, margin: 0 }}>
                Ask the person who shared it with you to send the link again.
              </p>
              <p className="muted" style={{ marginTop: 18, fontSize: 13 }}>
                <Link href="/" className="link">
                  Go to Odesseus.ai
                </Link>
              </p>
            </div>
          ) : (
            <GuestLiveShell token={token} />
          )}
        </section>
      </div>
    </main>
  );
}
