"use client";

import { useEffect, useMemo, useState } from "react";

type ActivityMetrics = {
  jobsScanned: number;
  matchesFound: number;
  jobsApplied: number;
  dataAsOf: string | null;
};

function updatedLabel(value: string | null) {
  if (!value) return "No activity yet";
  const time = new Date(value).getTime();
  if (Number.isNaN(time)) return "Latest available data";

  const diff = Math.max(0, Date.now() - time);
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 2) return "Updated just now";
  if (minutes < 60) return `Updated ${minutes} min ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `Updated ${hours} hr${hours === 1 ? "" : "s"} ago`;

  const days = Math.floor(hours / 24);
  if (days < 7) return `Updated ${days} day${days === 1 ? "" : "s"} ago`;

  return `Data as of ${new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(value))}`;
}

const iconStyle: React.CSSProperties = {
  width: 32,
  height: 32,
  borderRadius: 10,
  display: "grid",
  placeItems: "center",
  flex: "0 0 32px",
  fontSize: 18,
  lineHeight: 1,
  fontWeight: 800,
};

function LiveActivityPreview() {
  const [metrics, setMetrics] = useState<ActivityMetrics | null>(null);
  const [unavailable, setUnavailable] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const response = await fetch("/api/home/activity", {
          headers: { Accept: "application/json" },
          cache: "no-store",
        });
        if (!response.ok) throw new Error("activity request failed");

        const data = (await response.json()) as ActivityMetrics;
        if (!cancelled) {
          setMetrics(data);
          setUnavailable(false);
        }
      } catch {
        if (!cancelled) setUnavailable(true);
      }
    }

    void load();
    const interval = window.setInterval(load, 60_000);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, []);

  const rows = useMemo(
    () => [
      {
        key: "scan",
        icon: "▤",
        label: "Jobs Scanned",
        value: metrics ? metrics.jobsScanned.toLocaleString() : "—",
        background: "#fff1eb",
        color: "#0e0e1f",
        accent: "#ff4605",
        spark: "╲╱╲╱╲",
      },
      {
        key: "match",
        icon: "☆",
        label: "Matches Found",
        value: metrics ? metrics.matchesFound.toLocaleString() : "—",
        background: "#0e0e1f",
        color: "#ffffff",
        accent: "#ff7040",
        spark: "╱╲╱╲╱",
      },
      {
        key: "apply",
        icon: "➤",
        label: "Jobs Applied",
        value: metrics ? metrics.jobsApplied.toLocaleString() : "—",
        background: "#efe7ff",
        color: "#0e0e1f",
        accent: "#5c1fb8",
        spark: "╲╲╱╲╱",
      },
    ],
    [metrics]
  );

  return (
    <div
      aria-label="Odesseus live activity"
      style={{
        width: "100%",
        maxWidth: 570,
        boxSizing: "border-box",
        padding: 18,
        border: "1px solid #e7e3f0",
        borderRadius: 28,
        background: "#ffffff",
        boxShadow: "0 18px 55px rgba(14,14,31,.08)",
        overflow: "hidden",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 16,
          padding: "4px 2px 14px",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
          <span
            aria-hidden="true"
            style={{
              width: 16,
              height: 16,
              borderRadius: 999,
              background: "#ff4605",
              boxShadow: "0 0 0 5px rgba(255,70,5,.10)",
              flex: "0 0 16px",
            }}
          />
          <strong style={{ color: "#0e0e1f", fontSize: 15, fontWeight: 800 }}>
            Live Activity
          </strong>
        </div>
        <span style={{ color: "#77798a", fontSize: 12, textAlign: "right" }}>
          {unavailable ? "Activity unavailable" : updatedLabel(metrics?.dataAsOf ?? null)}
        </span>
      </div>

      <div style={{ display: "grid", gap: 12 }}>
        {rows.map((row) => (
          <div
            key={row.key}
            style={{
              display: "grid",
              gridTemplateColumns: "32px minmax(0,1fr) minmax(58px,96px) auto",
              alignItems: "center",
              gap: 12,
              minHeight: 98,
              padding: "16px 18px",
              borderRadius: 20,
              background: row.background,
              color: row.color,
              boxSizing: "border-box",
              overflow: "hidden",
            }}
          >
            <span
              aria-hidden="true"
              style={{
                ...iconStyle,
                color: row.accent,
                background: row.key === "match" ? "rgba(255,255,255,.08)" : "rgba(255,255,255,.55)",
              }}
            >
              {row.icon}
            </span>

            <strong
              style={{
                minWidth: 0,
                fontSize: "clamp(15px,1.5vw,20px)",
                lineHeight: 1.08,
                letterSpacing: "-.02em",
              }}
            >
              {row.label}
            </strong>

            <span
              aria-hidden="true"
              style={{
                color: row.accent,
                fontSize: "clamp(18px,2.2vw,28px)",
                fontWeight: 800,
                letterSpacing: "-.12em",
                whiteSpace: "nowrap",
                overflow: "hidden",
                opacity: 0.85,
              }}
            >
              {row.spark}
            </span>

            <b
              style={{
                justifySelf: "end",
                fontSize: "clamp(24px,2.6vw,34px)",
                lineHeight: 1,
                letterSpacing: "-.02em",
                whiteSpace: "nowrap",
              }}
            >
              {row.value}
            </b>
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
