import { isIP } from "node:net";
import { lookup } from "node:dns/promises";

// Blocks SSRF targets: loopback, link-local (incl. cloud metadata at
// 169.254.169.254), private/carrier-grade NAT ranges, and IPv6 equivalents.
// Resolves the hostname via DNS rather than string-matching it alone, so a
// public-looking hostname that resolves to a private address (DNS
// rebinding) is still caught.

function isPrivateIPv4(address: string): boolean {
  const parts = address.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => Number.isNaN(part))) return true;
  const [a, b] = parts;

  if (a === 127) return true; // loopback
  if (a === 10) return true; // private
  if (a === 172 && b >= 16 && b <= 31) return true; // private
  if (a === 192 && b === 168) return true; // private
  if (a === 169 && b === 254) return true; // link-local / cloud metadata
  if (a === 100 && b >= 64 && b <= 127) return true; // carrier-grade NAT
  if (a === 0) return true; // "this network"
  if (a >= 224) return true; // multicast/reserved

  return false;
}

function isPrivateIPv6(address: string): boolean {
  const normalized = address.toLowerCase();
  if (normalized === "::1") return true; // loopback
  if (normalized.startsWith("fe80:")) return true; // link-local
  if (normalized.startsWith("fc") || normalized.startsWith("fd")) return true; // unique local (fc00::/7)
  if (normalized.startsWith("::ffff:")) {
    // IPv4-mapped IPv6 — check the embedded IPv4 address.
    const embedded = normalized.split(":").pop() ?? "";
    if (isIP(embedded) === 4) return isPrivateIPv4(embedded);
  }
  return false;
}

function isPrivateAddress(address: string): boolean {
  const version = isIP(address);
  if (version === 4) return isPrivateIPv4(address);
  if (version === 6) return isPrivateIPv6(address);
  return true; // not a recognizable IP — treat as unsafe rather than assume safe
}

const BLOCKED_HOSTNAMES = new Set(["localhost", "metadata.google.internal"]);

export async function isSafeExternalUrl(rawUrl: string): Promise<{ safe: boolean; reason?: string }> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return { safe: false, reason: "Not a valid URL." };
  }

  if (url.protocol !== "https:") {
    return { safe: false, reason: "Only https:// URLs are allowed." };
  }

  const hostname = url.hostname.toLowerCase();
  if (BLOCKED_HOSTNAMES.has(hostname)) {
    return { safe: false, reason: "This host is not allowed." };
  }

  // A literal IP in the URL — check directly without a DNS round-trip.
  if (isIP(hostname)) {
    if (isPrivateAddress(hostname)) {
      return { safe: false, reason: "Private/internal addresses are not allowed." };
    }
    return { safe: true };
  }

  try {
    const results = await lookup(hostname, { all: true, verbatim: true });
    if (results.length === 0) {
      return { safe: false, reason: "Host could not be resolved." };
    }
    if (results.some((result) => isPrivateAddress(result.address))) {
      return { safe: false, reason: "This host resolves to a private/internal address." };
    }
  } catch {
    return { safe: false, reason: "Host could not be resolved." };
  }

  return { safe: true };
}
