import Link from "next/link";
import type { EmployerCapacity } from "@/lib/employers/types";

/**
 * Active-job capacity display (F13-G). Backend is authoritative — this
 * never blocks a submit itself, it only presents the count the adapter
 * returned and surfaces a backend-rejected-publish reason when given one.
 */
export default function EmployerCapacityBadge({
  capacity,
  rejectionReason,
}: {
  capacity: EmployerCapacity;
  rejectionReason?: string;
}) {
  const remaining = Math.max(0, capacity.planLimit - capacity.activeJobCount);
  const ratio = capacity.planLimit > 0 ? capacity.activeJobCount / capacity.planLimit : 0;
  const isAtLimit = capacity.activeJobCount >= capacity.planLimit;
  const isNearLimit = !isAtLimit && ratio >= 0.8;

  return (
    <div
      className={`emp-capacity-badge${isAtLimit ? " is-at-limit" : isNearLimit ? " is-near-limit" : ""}`}
      role="status"
    >
      <div className="emp-capacity-badge-row">
        <span>
          {capacity.activeJobCount} of {capacity.planLimit} active jobs used ({capacity.planId} plan)
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
