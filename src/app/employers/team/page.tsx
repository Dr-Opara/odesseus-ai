import { redirect } from "next/navigation";

/**
 * The team and seat roster lives at the canonical
 * `/employers/dashboard/team`.
 *
 * The Figma implementation originally shipped at `/employers/team`. Its
 * presentation and its real-data wiring were moved onto the canonical backend
 * route rather than kept as a second page, so there is one roster and one
 * source of truth for the seats behind it. This redirect preserves any link
 * that still points at the old path.
 */
export default function EmployerTeamRedirect() {
  redirect("/employers/dashboard/team");
}
