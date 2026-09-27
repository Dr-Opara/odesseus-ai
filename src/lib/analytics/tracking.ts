/**
 * Lightweight analytics / conversion tracking for Odesseus.
 *
 * Design goals:
 * - No external dependencies (no PostHog, GA, Mixpanel bundles in the client)
 * - Works server-side and client-side
 * - Respects DNT / privacy preferences
 * - Easy to swap provider later (PostHog, GA, custom endpoint)
 * - Events are typed and validated
 */

type EventName =
  | "signup_started"
  | "signup_completed"
  | "onboarding_started"
  | "onboarding_completed"
  | "resume_uploaded"
  | "match_requested"
  | "match_viewed"
  | "resume_tailoring_started"
  | "resume_tailoring_approved"
  | "application_started"
  | "application_submitted"
  | "wallet_topup_started"
  | "wallet_topup_completed"
  | "interview_scheduled"
  | "interview_prep_started"
  | "live_session_started"
  | "live_session_completed"
  | "partner_application_submitted"
  | "partner_referral_click"
  | "partner_referral_signup"
  | "partner_referral_conversion"
  | "careers_page_view"
  | "first_100_page_view"
  | "first_100_signup"
  | "pricing_view"
  | "employer_signup_started"
  | "employer_job_posted"
  | "settings_changed";

type EventProperties = Record<string, string | number | boolean | null | undefined>;

interface TrackEventInput {
  event: EventName;
  properties?: EventProperties;
  userId?: string;
  anonymousId?: string;
  timestamp?: number;
}

/**
 * Server-side event tracking.
 * In production, this would send to your analytics provider (PostHog, custom endpoint, etc.).
 * Currently logs to console in development and is a no-op in production without provider config.
 */
export async function trackEventServer(input: TrackEventInput): Promise<void> {
  const provider = process.env.ANALYTICS_PROVIDER?.toLowerCase();
  const endpoint = process.env.ANALYTICS_ENDPOINT;
  const apiKey = process.env.ANALYTICS_API_KEY;

  // Build the event payload
  const payload = {
    event: input.event,
    properties: input.properties || {},
    userId: input.userId,
    anonymousId: input.anonymousId,
    timestamp: input.timestamp ?? Date.now(),
  };

  // Development: log to console
  if (process.env.NODE_ENV !== "production") {
    console.log("[analytics]", JSON.stringify(payload));
    return;
  }

  // No provider configured: silently succeed (don't block app on analytics)
  if (!provider || (!endpoint && provider !== "console")) {
    return;
  }

  try {
    switch (provider) {
      case "posthog": {
        if (!apiKey || !endpoint) break;
        await fetch(`${endpoint.replace(/\/$/, "")}/capture/`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify({
            api_key: apiKey,
            event: input.event,
            properties: {
              ...input.properties,
              distinct_id: input.userId ?? input.anonymousId,
              $insert_id: `${input.userId ?? input.anonymousId}-${input.timestamp ?? Date.now()}`,
            },
            timestamp: new Date(input.timestamp ?? Date.now()).toISOString(),
          }),
        });
        break;
      }
      case "custom": {
        if (!endpoint) break;
        await fetch(endpoint, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
          },
          body: JSON.stringify(payload),
        });
        break;
      }
      case "console":
        // Explicit console logging in production (for debugging)
        console.log("[analytics]", JSON.stringify(payload));
        break;
    }
  } catch (error) {
    // Never throw - analytics failures must not affect user experience
    console.error("[analytics] failed to send event:", error);
  }
}

/**
 * Client-side event tracking.
 * Uses navigator.sendBeacon when available for reliability on page unload.
 * Falls back to fetch with keepalive.
 */
export function trackEventClient(input: TrackEventInput): void {
  // Respect Do Not Track
  if (typeof navigator !== "undefined" && navigator.doNotTrack === "1") {
    return;
  }

  const payload = {
    event: input.event,
    properties: input.properties || {},
    userId: input.userId,
    anonymousId: input.anonymousId ?? getAnonymousId(),
    timestamp: input.timestamp ?? Date.now(),
  };

  // In development, log to console
  if (process.env.NODE_ENV !== "production") {
    console.log("[analytics]", JSON.stringify(payload));
    return;
  }

  const endpoint = process.env.NEXT_PUBLIC_ANALYTICS_ENDPOINT;
  if (!endpoint) {
    // No endpoint configured - silently succeed
    return;
  }

  const body = JSON.stringify(payload);

  // Use sendBeacon if available (more reliable, works on page unload)
  if (typeof navigator !== "undefined" && navigator.sendBeacon) {
    const blob = new Blob([body], { type: "application/json" });
    navigator.sendBeacon(endpoint, blob);
    return;
  }

  // Fallback: fetch with keepalive
  if (typeof fetch !== "undefined") {
    fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      keepalive: true,
    }).catch(() => {
      // Ignore fetch errors
    });
  }
}

/**
 * Get or create a stable anonymous ID for the current browser session.
 * Stored in localStorage so it persists across page views.
 */
function getAnonymousId(): string {
  if (typeof window === "undefined") return "ssr";

  const key = "odesseus_anon_id";
  let id = localStorage.getItem(key);
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(key, id);
  }
  return id;
}

/**
 * Convenience wrapper for common conversion events.
 * These are the events that map to business outcomes.
 */
export const conversions = {
  signup: (userId: string, method: "email" | "google") =>
    trackEventClient({ event: "signup_completed", properties: { method }, userId }),

  onboardingComplete: (userId: string) =>
    trackEventClient({ event: "onboarding_completed", userId }),

  applicationSubmitted: (userId: string, jobId: string, priceCents: number) =>
    trackEventClient({
      event: "application_submitted",
      properties: { job_id: jobId, price_cents: priceCents },
      userId,
    }),

  walletTopup: (userId: string, amountCents: number) =>
    trackEventClient({
      event: "wallet_topup_completed",
      properties: { amount_cents: amountCents },
      userId,
    }),

  liveSessionStarted: (userId: string, interviewId: string) =>
    trackEventClient({
      event: "live_session_started",
      properties: { interview_id: interviewId },
      userId,
    }),

  partnerReferralClick: (code: string, landingPath: string) =>
    trackEventClient({
      event: "partner_referral_click",
      properties: { code, landing_path: landingPath },
    }),

  partnerReferralSignup: (code: string, newUserId: string) =>
    trackEventClient({
      event: "partner_referral_signup",
      properties: { code },
      userId: newUserId,
    }),

  partnerReferralConversion: (code: string, amountCents: number) =>
    trackEventClient({
      event: "partner_referral_conversion",
      properties: { code, amount_cents: amountCents },
    }),
};

/**
 * Page view tracking helper.
 * Call from layout or page components.
 */
export function trackPageView(
  pathname: string,
  options?: { userId?: string; title?: string; referrer?: string },
): void {
  trackEventClient({
    event: `${pathname.replace(/\//g, "_").slice(1) || "home"}_view` as EventName,
    properties: {
      path: pathname,
      title: options?.title ?? document.title,
      referrer: options?.referrer ?? document.referrer,
    },
    userId: options?.userId,
  });
}

/**
 * Check if analytics is enabled (provider configured).
 */
export function isAnalyticsEnabled(): boolean {
  return Boolean(
    process.env.ANALYTICS_PROVIDER ||
      process.env.NEXT_PUBLIC_ANALYTICS_ENDPOINT,
  );
}