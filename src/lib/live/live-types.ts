/** Shared Live vocabulary, kept out of the client component so both the
 * applicant routes and the guest routes can use the same types. */
export type CaptureMode = "microphone" | "shared_audio" | "mixed";

export type GuidanceMode = "default" | "star" | "shorter" | "technical" | "follow_up" | "manual";

export type GuestInterviewType =
  | "recruiter"
  | "hiring_manager"
  | "behavioral"
  | "technical"
  | "panel"
  | "executive"
  | "other";
