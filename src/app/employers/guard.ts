import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getEmployerOrgContext } from "@/lib/employers/org";
import type { EmployerRole } from "@/lib/employers/types";

export type EmployerPageContext = {
  userId: string;
  orgId: string;
  role: EmployerRole;
};

/**
 * Authenticated employer guard shared by every employer screen (F3).
 *
 * Two things are checked, in the same order the backend's own portal does:
 * 1. There is a session. A signed-out visitor is sent to the employer sign-in
 *    page, never the candidate one — an employer on a shared device should
 *    not land on a candidate login form.
 * 2. The session belongs to an employer account. Either the `account_type`
 *    claim or a real `employer_members` row is accepted, so somebody who is
 *    both a candidate and a company owner is not locked out of their company.
 *
 * The org id is resolved from the caller's own membership row, so a page can
 * never be pointed at another company's data. An employer with no membership
 * is sent to onboarding rather than shown an empty company dashboard.
 */
export async function requireEmployerPage(nextPath: string): Promise<EmployerPageContext> {
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  const user = data.user;

  if (!user) {
    redirect(`/employers/login?next=${encodeURIComponent(nextPath)}`);
  }

  const org = await getEmployerOrgContext();
  const claimsEmployer = user.user_metadata?.account_type === "employer";

  if (!org) {
    if (claimsEmployer) {
      // Signed up but never provisioned: finish company setup.
      redirect("/employers/onboarding/company");
    }
    await supabase.auth.signOut();
    redirect("/employers/login?error=This%20account%20is%20not%20registered%20as%20an%20employer.");
  }

  return { userId: user.id, orgId: org.orgId, role: org.role };
}
