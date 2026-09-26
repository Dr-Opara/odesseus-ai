/**
 * Admin authorization (Phase 9A).
 *
 * Every admin route resolves the caller through `requireCapability`, never
 * through a role comparison at the call site. A route that asks for a
 * capability keeps working if the role model is renamed or extended; a route
 * that branches on `role === "finance_admin"` silently inverts the moment a
 * role is added.
 *
 * The `ODESSEUS_ADMIN_EMAILS` bootstrap is preserved from the previous
 * implementation: an allow-listed address is granted the `admin` role and
 * written to `admin_users` on first sight, so an operator can provision
 * themselves without a database session. It mints full admin capability, which
 * is the existing behaviour and the reason the variable must be treated as a
 * production secret rather than a convenience.
 */

import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import {
  parseAdminRole,
  roleHasCapability,
  type AdminCapability,
  type AdminRole,
} from "@/lib/admin/capabilities";

export type AdminAuthorization =
  | { ok: true; userId: string; role: AdminRole; userEmail: string | null }
  | { ok: false; status: 401 | 403; error: string };

/**
 * The admin role for a user, or null. Mirrors the previous `isAdmin` contract,
 * including the allow-list bootstrap, so callers that only need "is this an
 * admin at all" can keep using it.
 *
 * A role that is not one of the three current values is treated as no access
 * rather than passed through. An unrecognised role is a row somebody added by
 * hand, and the safe reading of an unrecognised privilege is that it grants
 * none.
 */
export async function resolveAdminRole(userId: string): Promise<AdminRole | null> {
  const service = createServiceClient();
  const { data } = await service
    .from("admin_users")
    .select("role")
    .eq("user_id", userId)
    .maybeSingle();

  const stored = parseAdminRole(data?.role);
  if (stored) return stored;

  const allowed = (process.env.ODESSEUS_ADMIN_EMAILS || "")
    .split(",")
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);

  if (!allowed.length) return null;

  const { data: authUser } = await service.auth.admin.getUserById(userId);
  const email = authUser?.user?.email?.trim().toLowerCase();
  if (!email || !allowed.includes(email)) return null;

  await service.from("admin_users").upsert({ user_id: userId, role: "admin" });

  return "admin";
}

/**
 * Resolves the signed-in caller from the request's session and requires one
 * capability. Returns a discriminated result rather than a Response so the
 * service layer is testable on its own and the route cannot forget to handle a
 * failure case.
 */
export async function requireCapability(
  request: Request,
  capability: AdminCapability
): Promise<AdminAuthorization> {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getClaims();
  const userId = auth?.claims?.sub;

  if (!userId) return { ok: false, status: 401, error: "Please sign in again." };

  // The email comes from the session claims, not a second lookup: the audit log
  // stores it as a snapshot so an action stays attributable after the admin
  // account is deleted, and a claim is free.
  const userEmail = typeof auth?.claims?.email === "string" ? auth.claims.email : null;

  const role = await resolveAdminRole(userId);
  if (!role) return { ok: false, status: 403, error: "Admin access required." };

  if (!roleHasCapability(role, capability)) {
    return {
      ok: false,
      status: 403,
      // Deliberately the same message as "not an admin". Telling a signed-in
      // non-admin which capability they lack turns the console into a map of
      // what exists, and the capability list is in the bundle anyway.
      error: "Admin access required.",
    };
  }

  return { ok: true, userId, role, userEmail };
}

/** The failure branch of `requireCapability` as an HTTP response. */
export function adminAuthorizationError(result: { status: 401 | 403; error: string }) {
  return NextResponse.json({ error: result.error }, { status: result.status });
}

/** Standard headers for an admin read: never cached, never stored. */
export const ADMIN_RESPONSE_HEADERS = { "Cache-Control": "private, no-store" } as const;
