/**
 * Guest Live data layer (F2).
 *
 * Guest Live is intentionally no-account: no login, no signup, no payment,
 * no wallet, no guest slots, and no email invite flow. The Share Annual owner
 * mints a link, copies it manually, and the guest opens it. The link token is
 * the entire credential.
 *
 * Everything here is scoped to the one guest record the token resolves to. The
 * backend never returns the link owner's profile, resume, applications,
 * wallet, billing, or any other guest's session through these routes, and this
 * module never requests an owner-scoped route.
 */
import type { GuestInterviewType } from "@/lib/live/live-types";

/** A link token is 64 hex characters; anything else is not a guest link. */
export function isPlausibleGuestToken(token: string): boolean {
  return /^[0-9a-f]{64}$/.test(token);
}

export type GuestLinkStatus = {
  valid: boolean;
  /** "pending" until the guest starts, then "active", then "completed". */
  status: "pending" | "active" | "completed";
  setupComplete: boolean;
  guestName: string | null;
  hasSession: boolean;
  /** The backend's own message for a retired or unrecognised link. */
  reason?: string;
};

async function guestRequest<T>(path: string, init?: RequestInit): Promise<T | null> {
  try {
    const response = await fetch(path, { cache: "no-store", ...init });
    const payload = (await response.json().catch(() => null)) as (T & { error?: string }) | null;
    if (!response.ok) return null;
    return payload;
  } catch {
    return null;
  }
}

/** Validate a shared link. A wrong token and a retired link look identical. */
export async function readGuestLink(token: string): Promise<GuestLinkStatus> {
  const payload = await guestRequest<{
    valid?: boolean;
    status?: GuestLinkStatus["status"];
    setupComplete?: boolean;
    guestName?: string | null;
    hasSession?: boolean;
    error?: string;
  }>(`/api/live/guest-access/${encodeURIComponent(token)}`);

  if (!payload?.valid) {
    return {
      valid: false,
      status: "completed",
      setupComplete: false,
      guestName: null,
      hasSession: false,
      reason: payload?.error ?? "This guest link is not valid.",
    };
  }

  return {
    valid: true,
    status: payload.status ?? "pending",
    setupComplete: Boolean(payload.setupComplete),
    guestName: payload.guestName ?? null,
    hasSession: Boolean(payload.hasSession),
  };
}

export type GuestSetupInput = {
  name: string;
  company: string;
  roleTitle: string;
  jobDescription?: string;
  resumeText?: string;
  interviewType?: GuestInterviewType;
  round?: string;
  notes?: string;
};

/** Save the guest's own interview context. Belongs to the guest session only. */
export async function saveGuestSetup(token: string, input: GuestSetupInput): Promise<string | null> {
  const payload = await guestRequest<{ ok?: boolean; error?: string }>(
    `/api/live/guest-access/${encodeURIComponent(token)}/setup`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: input.name,
        company: input.company,
        roleTitle: input.roleTitle,
        jobDescription: input.jobDescription || null,
        resumeText: input.resumeText || null,
        interviewType: input.interviewType || null,
        round: input.round || null,
        notes: input.notes || null,
      }),
    }
  );
  if (!payload) return "Odesseus could not save your setup.";
  return null;
}

/**
 * Upload a resume for this guest session. The file is stored under a
 * guest-scoped path server-side and never enters the owner's Resume Hub.
 */
export async function uploadGuestResume(token: string, file: File): Promise<string | null> {
  try {
    const form = new FormData();
    form.append("resume", file);
    const response = await fetch(`/api/live/guest-access/${encodeURIComponent(token)}/resume`, {
      method: "POST",
      body: form,
    });
    const payload = (await response.json().catch(() => null)) as { ok?: boolean; parsed?: boolean; error?: string } | null;
    if (!response.ok) {
      return payload?.error ?? "Odesseus could not store your resume.";
    }
    return null;
  } catch {
    return "Odesseus could not reach the Live service.";
  }
}

export type GuestSessionState = {
  hasSession: boolean;
  sessionId?: string;
  status?: string;
  activatedAt?: string | null;
  endedAt?: string | null;
  transcriptItems?: {
    id: number;
    transcript: string;
    is_question: boolean;
    question_text?: string | null;
    occurred_at: string;
  }[];
  guidanceItems?: {
    id: string;
    question_text?: string | null;
    response_text?: string | null;
    structure?: string | null;
    verified_evidence?: string[] | null;
    caution?: string | null;
    created_at: string;
  }[];
};

/** The guest's own session state: transcript and guidance, nothing else. */
export async function readGuestSession(token: string): Promise<GuestSessionState | null> {
  return guestRequest<GuestSessionState>(
    `/api/live/guest-access/${encodeURIComponent(token)}/session`
  );
}

/**
 * Guest post-interview result. The backend generates a factual summary and a
 * reviewable follow-up draft from the guest's own transcript and resume. It
 * returns no scores and no hiring prediction, and this layer only reports
 * what the call confirmed.
 */
export async function createGuestPostAnalysis(
  token: string
): Promise<{ ok: true } | { ok: false; reason: string }> {
  try {
    const response = await fetch(`/api/live/guest-access/${encodeURIComponent(token)}/session/post-analysis`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    const payload = (await response.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
    if (!response.ok || !payload?.ok) {
      return {
        ok: false,
        reason: payload?.error ?? "Odesseus could not analyze this guest session.",
      };
    }
    return { ok: true };
  } catch {
    return { ok: false, reason: "Odesseus could not reach the Live service." };
  }
}
