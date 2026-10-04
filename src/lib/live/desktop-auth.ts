import { createHash, randomBytes } from "node:crypto";
import { createServiceClient } from "@/lib/supabase/service";

export const DESKTOP_LAUNCH_TTL_MS = 5 * 60 * 1000;
export const DESKTOP_ACCESS_TTL_MS = 6 * 60 * 60 * 1000;

export function createDesktopOpaqueToken() {
  return randomBytes(32).toString("base64url");
}

export function hashDesktopToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

function readBearer(request: Request) {
  const authorization = request.headers.get("authorization") || "";
  const [scheme, token] = authorization.split(/\s+/, 2);
  if (scheme?.toLowerCase() !== "bearer" || !token || token.length < 20) {
    return null;
  }
  return token;
}

export type DesktopAuthorization =
  | {
      ok: true;
      service: ReturnType<typeof createServiceClient>;
      desktopSession: {
        id: string;
        live_session_id: string;
        interview_id: string;
        user_id: string;
        access_expires_at: string;
      };
      liveSession: {
        id: string;
        interview_id: string;
        user_id: string;
        status: string;
        capture_mode: string;
        context_snapshot: unknown;
        activated_at: string | null;
        created_at: string;
      };
    }
  | { ok: false; status: 401 | 409; error: string };

export async function authorizeDesktopRequest(
  request: Request
): Promise<DesktopAuthorization> {
  const bearer = readBearer(request);
  if (!bearer) {
    return { ok: false, status: 401, error: "Desktop session authorization is required." };
  }

  const service = createServiceClient();
  const now = new Date().toISOString();
  const hash = hashDesktopToken(bearer);

  const { data: desktopSession } = await service
    .from("live_desktop_sessions")
    .select("id,live_session_id,interview_id,user_id,access_expires_at")
    .eq("access_token_hash", hash)
    .is("revoked_at", null)
    .gt("access_expires_at", now)
    .maybeSingle();

  if (!desktopSession) {
    return { ok: false, status: 401, error: "Desktop session authorization expired." };
  }

  const { data: liveSession } = await service
    .from("live_interview_sessions")
    .select("id,interview_id,user_id,status,capture_mode,context_snapshot,activated_at,created_at")
    .eq("id", desktopSession.live_session_id)
    .eq("interview_id", desktopSession.interview_id)
    .eq("user_id", desktopSession.user_id)
    .maybeSingle();

  if (!liveSession) {
    return { ok: false, status: 409, error: "Live session is no longer available." };
  }

  if (["completed", "ended", "expired", "failed"].includes(liveSession.status)) {
    return { ok: false, status: 409, error: "This Live session has already ended." };
  }

  return {
    ok: true,
    service,
    desktopSession,
    liveSession,
  };
}
