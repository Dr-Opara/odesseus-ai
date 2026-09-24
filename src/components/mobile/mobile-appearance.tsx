"use client";

import { useSyncExternalStore } from "react";
import MobileScreen from "@/components/mobile/mobile-screen";

type Mode = "light" | "dark" | "system";

const STORAGE_KEY = "odesseus-appearance-demo";
const CHANGE_EVENT = "odesseus-appearance-change";

const OPTIONS: { mode: Mode; icon: string; color: string; title: string; sub: string }[] = [
  { mode: "light", icon: "☀", color: "var(--m-orange)", title: "Light", sub: "Bright background" },
  { mode: "dark", icon: "🌙", color: "#0e0f21", title: "Dark", sub: "Dark interface" },
  { mode: "system", icon: "⚙", color: "#1abad1", title: "System", sub: "Match device setting" },
];

function readStoredMode(): Mode {
  if (typeof window === "undefined") return "system";
  const stored = window.localStorage.getItem(STORAGE_KEY);
  return stored === "light" || stored === "dark" || stored === "system" ? stored : "system";
}

function subscribe(callback: () => void) {
  window.addEventListener(CHANGE_EVENT, callback);
  window.addEventListener("storage", callback);
  return () => {
    window.removeEventListener(CHANGE_EVENT, callback);
    window.removeEventListener("storage", callback);
  };
}

/**
 * Mobile Appearance (screen 20). No theme system exists in the app yet, so
 * this only stores a client-side preference (localStorage) — it does not
 * actually change the rendered theme. BACKEND TODO (Phase 5): a real
 * light/dark/system theme implementation.
 */
export default function MobileAppearance() {
  const mode = useSyncExternalStore(subscribe, readStoredMode, () => "system");

  function choose(next: Mode) {
    window.localStorage.setItem(STORAGE_KEY, next);
    window.dispatchEvent(new Event(CHANGE_EVENT));
  }

  return (
    <MobileScreen index="20" title="Appearance" lead="Choose how Odesseus looks on this device.">
      <div className="m-list">
        {OPTIONS.map((option) => {
          const selected = mode === option.mode;
          return (
            <button
              key={option.mode}
              type="button"
              className={`m-card m-appearance-row${selected ? " is-selected" : ""}`}
              onClick={() => choose(option.mode)}
            >
              <span className="m-icon m-icon-circle" style={{ background: option.color, color: "#fff" }}>
                {option.icon}
              </span>
              <span className="m-copy">
                <strong>{option.title}</strong>
                <small>{option.sub}</small>
              </span>
              <span className={`m-radio${selected ? " is-checked" : ""}`} aria-hidden="true" />
            </button>
          );
        })}
      </div>
    </MobileScreen>
  );
}