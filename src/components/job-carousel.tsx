"use client";

function ActivityIcon({ type }: { type: "scan" | "match" | "apply" }) {
  if (type === "scan") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <rect x="3.5" y="5" width="17" height="14" rx="3" fill="none" stroke="currentColor" strokeWidth="1.7" />
        <path d="M7 10h1M11.5 10h1M16 10h1" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      </svg>
    );
  }

  if (type === "match") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="m12 3 2.4 5 5.5.8-4 3.9.9 5.5L12 15.7 7.2 18.2l.9-5.5-4-3.9L9.6 8 12 3Z" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
      </svg>
    );
  }

  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="m3.5 11.3 16.8-7.5-5.4 16.4-3.5-6.2-7.9-2.7Z" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
      <path d="m11.4 14 4.2-5.2" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  );
}

function Sparkline({ variant }: { variant: "scan" | "match" | "apply" }) {
  const path =
    variant === "scan"
      ? "M2 18 C10 17 12 31 21 25 S31 9 40 17 S51 5 60 12 S71 26 80 11"
      : variant === "match"
        ? "M2 23 C10 22 10 7 18 7 S28 26 37 18 S45 10 53 18 S65 28 80 9"
        : "M2 12 C11 9 17 5 24 11 S38 27 46 26 S55 9 63 18 S70 18 80 8";

  return (
    <svg className="oh-live-activity-spark" viewBox="0 0 82 34" aria-hidden="true">
      <path d={path} fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

function LiveActivityPreview() {
  const rows = [
    { type: "scan" as const, label: "Jobs Scanned", value: "847,696" },
    { type: "match" as const, label: "Matches Found", value: "1,322" },
    { type: "apply" as const, label: "Jobs Applied", value: "110" },
  ];

  return (
    <div className="oh-live-activity-card" aria-label="Odesseus live activity preview">
      <div className="oh-live-activity-header">
        <div>
          <span className="oh-live-activity-dot" aria-hidden="true" />
          <strong>Live Activity</strong>
        </div>
        <span>Updated just now</span>
      </div>

      <div className="oh-live-activity-list">
        {rows.map((row) => (
          <div className={`oh-live-activity-row is-${row.type}`} key={row.label}>
            <span className="oh-live-activity-icon">
              <ActivityIcon type={row.type} />
            </span>
            <strong>{row.label}</strong>
            <Sparkline variant={row.type} />
            <b>{row.value}</b>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function JobCarousel({
  result: _result,
  onRetry: _onRetry,
}: {
  result: unknown;
  onRetry: () => void;
}) {
  return <LiveActivityPreview />;
}
