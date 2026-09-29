import Link from "next/link";
import type { EmployerCapacity } from "@/lib/employers/types";

/**
 * Active-job capacity display (F13-G).
 *
 * The backend is authoritative. This component never blocks a submit and never
 * decides whether a job may be published; it presents the count the server's
 * subscription carries and surfaces a backend-rejected-publish reason when one
 * is given.
 *
 * `planLimit` is deliberately nullable. An organization whose stored tier this
 * build does not recognise has no known limit, and rendering that as `0` would
 * claim they have used all of it. An unknown limit shows as unknown, with no
 * "at limit" or "near limit" styling — those states are computed only when
 * there is a real number to compare against.
 */
export default function EmployerCapacityBadge({
  capacity,
  rejectionReason,
}: {
  capacity: EmployerCapacity;
  rejectionReason?: string;
}) {
  const limit = capacity.planLimit;

  if (limit === null) {
    return (
      <div className="emp-capacity-badge" role="status">
        <div className="emp-capacity-badge-row">
          <span>
            {capacity.activeJobCount} active job
            {capacity.activeJobCount === 1 ? "" : "s"}
            {capacity.planId ? ` on your ${capacity.planId} plan` : ""}
          </span>
        </div>
        <p className="emp-capacity-message">
          Your plan&rsquo;s active job limit is not available right now. Publishing will be
          decided when you submit.
        </p>
        {rejectionReason ? (
          <p className="emp-capacity-message is-error">{rejectionReason}</p>
        ) : null}
      </div>
    );
  }

  const remaining = Math.max(0, limit - capacity.activeJobCount);
  const ratio = limit > 0 ? capacity.activeJobCount / limit : 0;
  const isAtLimit = capacity.activeJobCount >= limit;
  const isNearLimit = !isAtLimit && ratio >= 0.8;

  return (
    <div
      className={`emp-capacity-badge${isAtLimit ? " is-at-limit" : isNearLimit ? " is-near-limit" : ""}`}
      role="status"
    >
      <div className="emp-capacity-badge-row">
        <span>
          {capacity.activeJobCount} of {limit} active jobs used
          {capacity.planId ? ` (${capacity.planId} plan)` : ""}
        </span>
        {isAtLimit || isNearLimit ? (
          <Link href="/employers/pricing" className="emp-capacity-upgrade">
            Upgrade plan →
          </Link>
        ) : null}
      </div>
      {isAtLimit ? (
        <p className="emp-capacity-message">
          Active job limit reached. Close a job or upgrade to publish another.
        </p>
      ) : isNearLimit ? (
        <p className="emp-capacity-message">
          {remaining} active job slot{remaining === 1 ? "" : "s"} remaining on this plan.
        </p>
      ) : null}
      {rejectionReason ? <p className="emp-capacity-message is-error">{rejectionReason}</p> : null}
    </div>
  );
}
