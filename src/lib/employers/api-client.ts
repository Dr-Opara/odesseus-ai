/**
 * Employer API client (F1).
 *
 * Every employer adapter talks to the real backend through this one helper.
 * Production never falls back to a fixture: a failed or unreachable request
 * resolves to `null` and the calling adapter returns an honest `unavailable`
 * result, which the existing state panels already render. Development and
 * test may fall back to dev fixtures only when this returns `null`.
 *
 * All employer endpoints are org-scoped
 * (`/api/employer/orgs/{orgId}/...`), so the org id is threaded through
 * rather than being guessed. The caller's org is resolved once per request
 * from their own membership row — never from client input.
 */

export type EmployerApiFailure = { ok: false; status: number; reason: string };

export type EmployerApiResponse<T> = { ok: true; data: T } | EmployerApiFailure;

type RequestOptions = {
  method?: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
  body?: unknown;
  /** Forward the caller's session cookie (server-side reads). */
  cookie?: string | null;
  /** Absolute origin for server-side reads; omitted for browser reads. */
  origin?: string | null;
};

/**
 * Absolute origin for a server-side read, so the caller's session cookie
 * travels with the request. Returns null outside a request scope (browser
 * calls, tests, scripts), where a relative URL is already correct.
 */
async function requestOrigin(): Promise<string | null> {
  if (typeof window !== "undefined") return null;
  try {
    const { headers } = await import("next/headers");
    const requestHeaders = await headers();
    const host = requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host");
    if (!host) return null;
    const proto =
      requestHeaders.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
    return `${proto}://${host}`;
  } catch {
    return null;
  }
}

/** Perform one employer API call. Never throws. */
export async function employerApi<T>(path: string, options: RequestOptions = {}): Promise<EmployerApiResponse<T>> {
  try {
    const method = options.method ?? "GET";
    const origin = options.origin ?? (await requestOrigin());
    const url = `${origin ?? ""}${path}`;

    const headers: Record<string, string> = {};
    if (options.body !== undefined) headers["Content-Type"] = "application/json";
    if (options.cookie) headers.cookie = options.cookie;

    const response = await fetch(url, {
      method,
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      cache: "no-store",
    });

    const text = await response.text();
    const payload = text ? (safeParse(text) as unknown) : null;

    if (!response.ok) {
      return {
        ok: false,
        status: response.status,
        reason: readError(payload) ?? defaultReason(response.status),
      };
    }
    return { ok: true, data: (payload ?? null) as T };
  } catch {
    return { ok: false, status: 0, reason: "Odesseus could not reach the employer service." };
  }
}

function safeParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/** Preserve the backend's own message verbatim — it owns the wording. */
function readError(payload: unknown): string | null {
  if (payload && typeof payload === "object" && "error" in payload) {
    const error = (payload as { error?: unknown }).error;
    if (typeof error === "string" && error.trim()) return error;
  }
  return null;
}

function defaultReason(status: number): string {
  if (status === 401) return "Please sign in again.";
  if (status === 403) return "You do not have access to this hiring team.";
  if (status === 404) return "That could not be found.";
  if (status === 409) return "That action conflicts with the current state.";
  if (status === 402) return "Your plan does not allow that right now.";
  if (status === 429) return "Too many requests. Please wait a moment.";
  return "Odesseus could not complete that request.";
}
