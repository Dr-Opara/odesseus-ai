"use client";

import { useState } from "react";
import MobileScreen from "@/components/mobile/mobile-screen";

/**
 * Mobile Refer a Friend (screen 21). The referral link is real (derived from
 * the candidate's own account), and Copy/Share are real browser capabilities.
 * There is no candidate-referral tracking table yet (the existing
 * `partner_referrals` table is for the employer partner program, a different
 * feature) — Invited/Joined honestly show 0 rather than a fabricated count.
 * BACKEND TODO (Phase 5): a real candidate referral-tracking table + reward
 * ledger.
 */
export default function MobileReferFriend({ referralSlug }: { referralSlug: string }) {
  const [copied, setCopied] = useState(false);
  const link = `odesseus.ai/r/${referralSlug}`;

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(`https://${link}`);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }

  async function shareLink() {
    const shareData = {
      title: "Odesseus.ai",
      text: "Discover a smarter way to manage your job search.",
      url: `https://${link}`,
    };
    if (navigator.share) {
      await navigator.share(shareData).catch(() => null);
    } else {
      await copyLink();
    }
  }

  return (
    <MobileScreen
      index="21"
      title="Refer a Friend"
      lead="Help someone discover a smarter way to manage their job search."
    >
      <div className="m-referral-hero">
        <span className="m-referral-hero-icon" aria-hidden="true">
          ↗
        </span>
        <strong>Share Odesseus.ai</strong>
        <span>Invite friends with your personal referral link.</span>
      </div>

      <div className="m-referral-link-row">
        <span>{link}</span>
        <button type="button" className="m-referral-copy" onClick={copyLink}>
          {copied ? "Copied" : "Copy"}
        </button>
      </div>

      <button type="button" className="m-referral-share" onClick={shareLink}>
        Share referral link
      </button>

      <p className="m-eyebrow" style={{ margin: "18px 4px 8px" }}>
        YOUR REFERRALS
      </p>
      <div className="m-referral-stats">
        <div>
          <strong style={{ color: "var(--m-orange)" }}>0</strong>
          <span>Invited</span>
        </div>
        <div>
          <strong style={{ color: "#26cc7a" }}>0</strong>
          <span>Joined</span>
        </div>
        <div className="m-referral-rewards">
          <strong>Rewards</strong>
          <span>Coming soon</span>
        </div>
      </div>
    </MobileScreen>
  );
}
