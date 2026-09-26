import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getEmployerOverview, getEmployerUserId } from "@/lib/employer/service";
import type { EmployerOverview } from "@/lib/employer/types";

/**
 * Authenticated employer guard shared by every portal page (Phase 5).
 *
 * `/employers/dashboard` and its sub-pages are not in the auth proxy's public
 * list, so a signed-out visitor is already bounced to the candidate login by
 * the middleware. This guard adds the two employer-specific checks the
 * middleware cannot make:
 *
 * 1. The session is an employer session. An `employer_members` row is the
 *    strong signal and the `account_type` auth claim is the weak one; either is
 *    accepted, so a person who is both a candidate and a company owner is not
 *    locked out of their own company.
 * 2. The session belongs to *this* page's organization. The organization is
 *    resolved from `employer_members` and every downstream read is scoped to
 *    that id, so a page can never be pointed at another company's data.
 *
 * A signed-out visitor goes to the employer sign-in page, not the candidate
 * one: an employer on a shared device should never land on a candidate login
 * form, and the phone flow is Business Login -> dashboard.
 */
export async function requireEmployerOverview(nextPath: string): Promise<EmployerOverview> {
  const supabase = await createClient();
  const userId = await getEmployerUserId(supabase);

  if (!userId) {
    redirect(`/employers/login?next=${encodeURIComponent(nextPath)}`);
  }

  const overview = await getEmployerOverview(supabase, userId);

  if (!overview.account.isEmployerAccount && !overview.yourRole) {
    // A candidate account that wandered into the employer portal. Send them to
    // their own app rather than signing them out of a session they may still
    // be using, and rather than rendering an empty company dashboard.
    redirect("/dashboard");
  }

  return overview;
}
