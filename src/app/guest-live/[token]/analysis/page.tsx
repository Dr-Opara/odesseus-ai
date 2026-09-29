import type { Metadata } from "next";
import LiveGuestAnalysis from "@/components/live/guest/live-guest-analysis";

/**
 * The guest's post-interview analysis.
 *
 * Same no-index rule as the guest landing: the token is the credential and it
 * is in the URL, so this page must never be indexed or previewed.
 */
export const metadata: Metadata = {
  title: "Odesseus Live",
  robots: { index: false, follow: false, nocache: true },
};

export default async function GuestLiveAnalysisPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  return <LiveGuestAnalysis token={token} />;
}
