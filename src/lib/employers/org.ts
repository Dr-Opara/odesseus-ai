/**
 * Resolves which hiring team the signed-in employer belongs to (F1).
 *
 * Every real employer endpoint is org-scoped (`/api/employer/orgs/{orgId}/…`),
 * so the frontend needs the caller's own org id. It is read from the caller's
 * own `employer_members` row through their own session client, which row-level
 * security already restricts to memberships that are theirs — the frontend
 * never accepts an org id from the browser and never uses a service key.
 *
 * The narrow structural type in `@/types/employer-membership` keeps this read
 * to exactly two columns without editing the generated `Database` type.
 */
import { createClient } from "@/lib/supabase/server";
import type { EmployerRole } from "./types";
import type {
  MembershipReadable,
  EmployerMembershipRow,
} from "@/types/employer-membership";

export type EmployerOrgContext = {
  orgId: string;
  role: EmployerRole;
};

function toRole(value: string): EmployerRole {
  if (value === "admin" || value === "recruiter" || value === "viewer") return value;
  return "owner";
}

/** The caller's own employer membership, or null when they have none yet. */
export async function getEmployerOrgContext(): Promise<EmployerOrgContext | null> {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getClaims();
  const userId = auth?.claims?.sub;
  if (!userId) return null;

  const reader = supabase as unknown as MembershipReadable;
  const { data, error } = await reader
    .from("employer_members")
    .select("org_id,role")
    .eq("user_id", userId)
    .limit(1);

  if (error) return null;
  const row: EmployerMembershipRow | undefined = data?.[0];
  if (!row?.org_id) return null;

  return { orgId: row.org_id, role: toRole(row.role) };
}
