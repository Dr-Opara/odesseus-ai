import Link from "next/link";

export type EmployerStateKind =
  | "loading"
  | "empty"
  | "error"
  | "permission-denied"
  | "billing-required"
  | "capacity-reached";

/**
 * Shared state presentation for every employer screen (F13-P): loading,
 * empty ("No Jobs Yet" etc.), error, permission denied, billing required,
 * and capacity reached all render through this one component so the state
 * matrix looks consistent across the whole employer portal.
 */
export default function EmployerStatePanel({
  kind,
  title,
  message,
  onRetry,
  actionHref,
  actionLabel,
}: {
  kind: EmployerStateKind;
  title?: string;
  message?: string;
  onRetry?: () => void;
  actionHref?: string;
  actionLabel?: string;
}) {
  if (kind === "loading") {
    return (
      <div className="emp-state-panel is-loading" role="status" aria-live="polite">
        <div className="emp-state-skeleton" aria-hidden="true" />
        <div className="emp-state-skeleton" aria-hidden="true" />
        <div className="emp-state-skeleton" aria-hidden="true" />
      </div>
    );
  }

  return (
    <div className={`emp-state-panel is-${kind}`}>
      {title ? <strong>{title}</strong> : null}
      {message ? <p>{message}</p> : null}
      {onRetry ? (
        <button type="button" className="emp-state-retry" onClick={onRetry}>
          Retry
        </button>
      ) : null}
      {actionHref && actionLabel ? (
        <Link href={actionHref} className="emp-state-action">
          {actionLabel}
        </Link>
      ) : null}
    </div>
  );
}
