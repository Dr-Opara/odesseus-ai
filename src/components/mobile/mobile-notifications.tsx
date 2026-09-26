"use client";

import { useState } from "react";
import MobileScreen from "@/components/mobile/mobile-screen";
import MobileIconRow, { type IconColor } from "@/components/mobile/mobile-icon-row";

type Row = { key: string; icon: string; color: IconColor; title: string; sub: string; defaultOn: boolean };

const ROWS: Row[] = [
  { key: "applications", icon: "📋", color: "orange", title: "Application updates", sub: "Submission and status changes", defaultOn: true },
  { key: "documents", icon: "📄", color: "pink", title: "Documents", sub: "Resume and document changes", defaultOn: true },
  { key: "matches", icon: "🎯", color: "green", title: "Job matches", sub: "New high-match opportunities", defaultOn: true },
  { key: "activity", icon: "✨", color: "cyan", title: "Agent activity", sub: "Important Odesseus Agent actions", defaultOn: true },
  { key: "product", icon: "🚀", color: "navy", title: "Product updates", sub: "New features and announcements", defaultOn: false },
];

function Toggle({ on, onChange }: { on: boolean; onChange: () => void }) {
  return (
    <label className="m-switch" onClick={(event) => event.stopPropagation()}>
      <input type="checkbox" checked={on} onChange={onChange} />
      <span />
    </label>
  );
}

/**
 * Mobile Notifications (screen 16). No notification-preferences table exists
 * yet, so toggle state is local/client-only — a safe, visually correct demo
 * state, not persisted. BACKEND TODO (Phase 5): a real notification
 * preferences table + delivery pipeline.
 */
export default function MobileNotifications() {
  const [state, setState] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(ROWS.map((row) => [row.key, row.defaultOn]))
  );

  return (
    <MobileScreen index="16" title="Notifications" lead="Choose what Odesseus should notify you about.">
      <div className="m-list">
        {ROWS.map((row) => (
          <MobileIconRow
            key={row.key}
            icon={row.icon}
            color={row.color}
            title={row.title}
            sub={row.sub}
            right={
              <Toggle
                on={state[row.key]}
                onChange={() => setState((prev) => ({ ...prev, [row.key]: !prev[row.key] }))}
              />
            }
          />
        ))}
      </div>
    </MobileScreen>
  );
}
