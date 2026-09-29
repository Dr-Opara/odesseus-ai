import { redirect } from "next/navigation";

/**
 * Employer billing lives at the canonical `/employers/dashboard/billing`.
 *
 * The Figma implementation originally shipped at `/employers/billing`. Its
 * presentation and its real-data wiring were moved onto the canonical backend
 * route rather than kept as a second page, so there is one employer billing
 * surface and one source of truth for the subscription behind it.
 *
 * This is still a distinct surface from the candidate wallet at `/billing`:
 * a company subscription and a candidate's Apply wallet are different things,
 * and this redirect does not merge them.
 */
export default function EmployerBillingRedirect() {
  redirect("/employers/dashboard/billing");
}
