import { createServiceClient } from "@/lib/supabase/service";
import { requireOrgAdmin, type OrgRole } from "./service";

/**
 * The employer write path.
 *
 * `authenticated` holds SELECT only on every employer table, deliberately: a
 * missing role check in a route must not be exploitable through PostgREST, so
 * the database refuses the write no matter what the route believes. That is the
 * right default, and it has a consequence: the routes cannot use the caller's
 * session client to perform the write either, because it is the same role.
 *
 * So a mutation is a two-step, and this module exists to make the two steps
 * impossible to separate:
 *
 *     session client  ->  prove role  ->  service client  ->  write
 *
 * Authorization is proved on the *session* client, where RLS decides who the
 * caller is. Only once that has succeeded is a service client handed back, and
 * it is handed back by this function rather than created at the call site. A
 * route cannot reach a privileged client without having passed the check,
 * because there is no other way to obtain one.
 *
 * What this does not change:
 *
 *   - No `GRANT`. `authenticated` still cannot write any employer table.
 *   - No RLS policy is touched. The membership proof is still RLS's answer.
 *   - No credential reaches the browser. The service client is server-only and
 *     built from server environment variables.
 *
 * What keeps a cross-org write impossible even after the grant: every employer
 * mutation filters `.eq("org_id", orgId)`, and `orgId` is the one the check was
 * performed against. A service client bypasses RLS, so this filter is now the
 * load-bearing org boundary for these writes rather than a second layer -- which
 * is why the check above and the filter below must be the same org id, and why
 * the grant takes `orgId` as an argument rather than reading it from the
 * request.
 */

export type ServiceClient = ReturnType<typeof createServiceClient>;

export type OrgWriteGrant =
  | { ok: true; client: ServiceClient; role: OrgRole }
  | { ok: false; status: 403 | 404; error: string };

/**
 * Prove org-admin (owner or admin) and return a write client.
 *
 * A non-member and a non-admin are told apart so the route can answer 404 and
 * 403 respectively: telling an outsider "no such organization" avoids
 * confirming that an organization exists.
 */
export async function grantOrgAdminWrite(
  session: Parameters<typeof requireOrgAdmin>[0],
  actor: { orgId: string; userId: string }
): Promise<OrgWriteGrant> {
  const authz = await requireOrgAdmin(session, actor.orgId, actor.userId);
  if (!authz.ok) {
    return {
      ok: false,
      status: authz.reason === "not_a_member" ? 404 : 403,
      error:
        authz.reason === "not_a_member"
          ? "That team could not be found."
          : "Admin access required.",
    };
  }

  return { ok: true, client: createServiceClient(), role: authz.role };
}
