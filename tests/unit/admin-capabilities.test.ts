import { describe, expect, it } from "vitest";
import {
  ADMIN_CAPABILITIES,
  ADMIN_ROLES,
  ROLE_CAPABILITIES,
  capabilitiesForRole,
  isAdminRole,
  missingCapabilities,
  parseAdminRole,
  roleHasCapability,
  type AdminCapability,
  type AdminRole,
} from "@/lib/admin/capabilities";

describe("the admin role model", () => {
  it("covers exactly the three roles the roster column allows", () => {
    // admin_users.role has a CHECK constraint with these three values. If a role
    // is added in SQL and not here, it silently grants nothing -- which is the
    // safe direction, but should be noticed rather than relied on.
    expect([...ADMIN_ROLES].sort()).toEqual(["admin", "finance_admin", "marketing_admin"]);
  });

  it("rejects an unrecognised role rather than treating it as full admin", () => {
    // A hand-inserted row is not a grant. "I do not know what this privilege is"
    // has to resolve to none of it, or one bad row is a full-platform admin.
    expect(isAdminRole("superadmin")).toBe(false);
    expect(isAdminRole("")).toBe(false);
    expect(isAdminRole(null)).toBe(false);
    expect(isAdminRole(undefined)).toBe(false);
    expect(isAdminRole(1)).toBe(false);
    expect(parseAdminRole("superadmin")).toBeNull();
    expect(parseAdminRole("finance_admin")).toBe("finance_admin");
  });

  it("never lists a capability that is not in the published set", () => {
    // Otherwise `roleHasCapability` would accept a typo'd string typed as a
    // capability, and the guard would quietly be a no-op.
    const published = new Set<string>(ADMIN_CAPABILITIES);
    for (const role of ADMIN_ROLES) {
      for (const capability of ROLE_CAPABILITIES[role]) {
        expect(published.has(capability)).toBe(true);
      }
    }
  });

  it("gives every published capability to at least one role", () => {
    // A capability nobody holds is dead code wearing a guard's clothes: every
    // route refuses it and nothing explains why.
    const all = ADMIN_ROLES.flatMap((role) => ROLE_CAPABILITIES[role]);
    expect(new Set(all).size).toBe(ADMIN_CAPABILITIES.length);
  });

  it("grants a role no duplicate capability", () => {
    // BASELINE is spread into two roles, so a capability listed in both would
    // silently appear twice. Harmless to `includes`, but it hides the overlap
    // from anyone reading the map.
    for (const role of ADMIN_ROLES) {
      expect(new Set(ROLE_CAPABILITIES[role]).size).toBe(ROLE_CAPABILITIES[role].length);
    }
  });
});

describe("capability separation", () => {
  it("gives admin every capability", () => {
    expect(capabilitiesForRole("admin")).toEqual(ADMIN_CAPABILITIES);
  });

  it("stops a finance admin from moderating job reports", () => {
    // Settling a billing dispute is not a reason to decide whether a job
    // listing is a scam.
    expect(roleHasCapability("finance_admin", "wallet:adjust")).toBe(true);
    expect(roleHasCapability("finance_admin", "job_reports:moderate")).toBe(false);
    expect(roleHasCapability("finance_admin", "job_reports:read")).toBe(false);
  });

  it("stops a marketing admin from touching candidate money", () => {
    // The one that actually bit before this map existed: marketing_admin could
    // read a candidate's wallet balance, because every route accepted all
    // three roles.
    expect(roleHasCapability("marketing_admin", "wallet:read")).toBe(false);
    expect(roleHasCapability("marketing_admin", "wallet:adjust")).toBe(false);
    expect(roleHasCapability("marketing_admin", "wallet_ledger:read")).toBe(false);
    expect(roleHasCapability("marketing_admin", "billing_failures:read")).toBe(false);
  });

  it("stops a finance admin from changing who is an admin", () => {
    expect(roleHasCapability("finance_admin", "admin_users:manage")).toBe(false);
    expect(roleHasCapability("marketing_admin", "admin_users:manage")).toBe(false);
    expect(roleHasCapability("admin", "admin_users:manage")).toBe(true);
  });

  it("reserves moving money for finance and admin only", () => {
    // Stated as an invariant over the whole map rather than as two assertions,
    // so adding a fourth role cannot quietly gain it.
    for (const role of ADMIN_ROLES) {
      const movesMoney = roleHasCapability(role, "wallet:adjust");
      expect(movesMoney).toBe(role === "admin" || role === "finance_admin");
    }
  });

  it("keeps support reads available to every role", () => {
    // A person answering "where is my application" ticket is not asking for a
    // capability conversation first.
    for (const capability of ["users:read", "applications:read", "employers:read"] as const) {
      for (const role of ADMIN_ROLES) {
        expect(roleHasCapability(role, capability)).toBe(true);
      }
    }
  });

  it("keeps job visibility with marketing, and not with finance", () => {
    expect(roleHasCapability("marketing_admin", "employer_jobs:read")).toBe(true);
    expect(roleHasCapability("finance_admin", "employer_jobs:read")).toBe(false);
  });
});

describe("missingCapabilities", () => {
  it("names what a role lacks, so a console can explain a disabled control", () => {
    expect(missingCapabilities("finance_admin", ["job_reports:moderate"])).toEqual([
      "job_reports:moderate",
    ]);
  });

  it("returns an empty list when the role holds everything required", () => {
    expect(missingCapabilities("admin", ["wallet:adjust", "job_reports:moderate"])).toEqual([]);
  });

  it("is empty for a requirement the role already satisfies", () => {
    expect(missingCapabilities("finance_admin", ["wallet:read", "wallet:adjust"])).toEqual([]);
  });
});

describe("capabilitiesForRole", () => {
  it("returns the frozen shared array, so a stray mutation cannot widen a policy", () => {
    // Not a copy: the function runs on every admin request and a fresh array
    // each time is waste. Frozen instead, so the shared reference is safe even
    // when something bypasses the readonly type.
    const first = capabilitiesForRole("finance_admin" as AdminRole);
    expect(first).toBe(ROLE_CAPABILITIES.finance_admin);
    expect(Object.isFrozen(first)).toBe(true);
    expect(() => (first as AdminCapability[]).push("admin_users:manage")).toThrow();
    expect(roleHasCapability("finance_admin", "admin_users:manage")).toBe(false);
  });

  it("freezes every role's capability list", () => {
    for (const role of ADMIN_ROLES) {
      expect(Object.isFrozen(ROLE_CAPABILITIES[role])).toBe(true);
    }
  });
});
