import { redirect } from "next/navigation";

/**
 * The employer jobs list lives at the canonical `/employers/dashboard/jobs`.
 *
 * The Figma implementation originally shipped at `/employers/jobs`. Its
 * presentation and its real-data wiring were moved onto the canonical backend
 * route rather than kept as a second page, so there is one jobs list and one
 * source of truth for the data behind it. This redirect preserves any link
 * that still points at the old path.
 */
export default function EmployerJobsRedirect() {
  redirect("/employers/dashboard/jobs");
}
