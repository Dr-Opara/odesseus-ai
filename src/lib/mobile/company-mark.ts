import type { IconColor } from "@/components/mobile/mobile-icon-row";

const PALETTE: IconColor[] = [
  "purple",
  "teal",
  "green",
  "orange",
  "pink",
  "cyan",
  "olive",
  "navy",
  "red",
];

/**
 * Deterministic company-logo color, hashed from the company name so the same
 * company always renders the same color across screens without a real logo
 * asset library.
 */
export function companyMarkColor(companyName: string): IconColor {
  let hash = 0;
  for (let i = 0; i < companyName.length; i++) {
    hash = (hash * 31 + companyName.charCodeAt(i)) >>> 0;
  }
  return PALETTE[hash % PALETTE.length];
}

export function companyMarkInitial(companyName: string): string {
  return companyName.trim().slice(0, 1).toUpperCase() || "?";
}
