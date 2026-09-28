import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * One Live entitlement contract, three declarations, checked against each other.
 *
 * The Live access decision lives in the `odesseus_get_live_entitlement` database
 * function. It is described three more times: in the generated Supabase types,
 * in the app-side row type, and as the JSON each route emits. When those drift,
 * nothing fails. The compiler is satisfied by a cast, the database happily
 * returns a column nobody reads, and the symptom is a customer who paid for
 * Live and is told they have no access.
 *
 * These tests are the only thing standing between the three and that outcome.
 * They are static on purpose: the alternative is a test that mocks the RPC,
 * which would assert the shape against itself and prove nothing.
 */

const MIGRATION = join(
  process.cwd(),
  "supabase",
  "migrations",
  "20261018000000_live_entitlement_contract.sql"
);

/** The contract, in the order the SQL declares it. */
const CONTRACT = [
  "has_access",
  "source",
  "plan",
  "sessions_remaining",
  "period_end",
  "is_owner",
  "is_guest",
  "membership_id",
  "guest_limit",
  "activated_guest_count",
] as const;

/** The Phase 7A names the current contract replaced. */
const SUPERSEDED = [
  "has_entitlement",
  "entitlement_type",
  "passes_remaining",
  "unlimited_until",
  "fair_use_count",
  "fair_use_reset",
] as const;

function read(relativePath: string) {
  return readFileSync(join(process.cwd(), relativePath), "utf8");
}

describe("the SQL contract", () => {
  const sql = read("supabase/migrations/20261018000000_live_entitlement_contract.sql");

  it("declares exactly the ten columns, in order, and no more", () => {
    // The OUT parameter list is the contract. Read it as a block rather than
    // grepping, so a column added in a different place cannot slip past.
    const declaration = sql.match(
      /CREATE FUNCTION public\.odesseus_get_live_entitlement \(([\s\S]*?)\)\s*\n\s*LANGUAGE/
    );
    expect(declaration).not.toBeNull();

    const columns = [...(declaration as RegExpMatchArray)[1].matchAll(/OUT\s+(\w+)\s+\w+/g)].map(
      (match) => match[1]
    );

    expect(columns).toEqual([...CONTRACT]);
  });

  it("names none of the superseded columns", () => {
    for (const name of SUPERSEDED) {
      // `p_user_id` is the only argument; none of these may reappear as OUT
      // parameters. A comment mentioning one is fine and expected.
      expect(sql).not.toMatch(new RegExp(`OUT\\s+${name}\\b`));
    }
  });

  it("is reached by exactly one function name, so there is one decision", () => {
    // Two functions with the same purpose and different signatures is how the
    // interview screen and the billing screen end up disagreeing.
    const created = [...sql.matchAll(/CREATE (?:OR REPLACE )?FUNCTION public\.(\w+)/g)].map(
      (match) => match[1]
    );
    expect(created.filter((name) => name === "odesseus_get_live_entitlement")).toHaveLength(1);
  });

  it("reads the fair-use ceiling from the catalog, not a literal", () => {
    // A hardcoded ceiling here would silently disagree with the plan
    // configuration the catalog owns, and a customer on a reconfigured plan would
    // be limited by a number nobody can see.
    expect(sql).toContain("odesseus_private.live_fair_use_config()");

    // Only a zero may be assigned as a bare literal, and only on the paths that
    // report no access at all. `sessions_remaining := 0` is the fail-closed
    // answer; `:= 20` would be a private policy nobody can see or change.
    // Derived expressions are matched by name, not here.
    const literals = [...sql.matchAll(/sessions_remaining\s*:=\s*(\d+)\s*;/g)].map((match) =>
      match[1]
    );
    expect(literals.length).toBeGreaterThan(0);
    for (const literal of literals) {
      expect(literal === "0", `sessions_remaining := ${literal} is a literal policy`).toBe(true);
    }

    // The membership, guest, and legacy branches each read a configured ceiling.
    expect(sql).toContain("v_membership.fair_use_sessions - v_recent");
    expect(sql).toContain("v_fair_sessions - v_recent");
    expect(sql).toContain("coalesce(v_owner_membership.fair_use_sessions, v_fair_sessions) - v_recent");

    // The sentinel that was briefly used to fake an unbounded legacy window.
    expect(sql).not.toContain("2147483647");
  });

  it("grants the retired annual product the same ceiling keys, additively", () => {
    // The legacy window has no membership row, so it reads the catalog
    // directly. The metadata is a jsonb || concat: no price, no activation flag,
    // and no entitlement wording is touched by it.
    expect(sql).toMatch(
      /UPDATE public\.pricing_products\s+SET metadata = metadata \|\| jsonb_build_object/
    );
    expect(sql).toMatch(/WHERE product_key = 'candidate_live_annual'\s*\n\s*AND NOT \(metadata \?/);
  });

  it("keeps the entitlement function service-role only", () => {
    // Its result can reveal another user's membership and guest relationships,
    // so it must not be reachable from a browser session.
    expect(sql).toMatch(
      /REVOKE ALL ON FUNCTION public\.odesseus_get_live_entitlement\(uuid\) FROM PUBLIC, anon, authenticated/
    );
    expect(sql).toMatch(
      /GRANT EXECUTE ON FUNCTION public\.odesseus_get_live_entitlement\(uuid\) TO postgres, service_role/
    );
  });
});

describe("the generated database types", () => {
  const types = read("src/types/database.ts");

  it("states the same ten columns, untyped before and now", () => {
    const block = types.match(
      /odesseus_get_live_entitlement: \{[\s\S]*?Returns: \{([\s\S]*?)\};/
    );
    expect(block).not.toBeNull();

    const columns = [...(block as RegExpMatchArray)[1].matchAll(/^\s*(\w+)[?]?:/gm)].map(
      (match) => match[1]
    );
    expect(columns.sort()).toEqual([...CONTRACT].sort());
  });

  it("is no longer the single Record<string, unknown> in the file", () => {
    // That placeholder was the reason every caller re-declared the shape: an
    // untyped return is invisible to the compiler, so a rename cost nothing.
    expect(types).not.toMatch(
      /odesseus_get_live_entitlement[\s\S]{0,200}Returns: Record<string, unknown>/
    );

    // Counted over code only. The explanation written above the new type names
    // the old placeholder, and a comment is not an untyped return.
    const code = types.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    expect([...code.matchAll(/Record<string, unknown>/g)]).toHaveLength(0);
  });
});

describe("the app-side row type", () => {
  it("declares the same ten columns", async () => {
    const { LIVE_ENTITLEMENT_SOURCES, NO_LIVE_ENTITLEMENT } = await import(
      "@/lib/billing/live-entitlement"
    );

    expect(Object.keys(NO_LIVE_ENTITLEMENT).sort()).toEqual([...CONTRACT].sort());
    // The source union is the resolution order the SQL documents.
    expect([...LIVE_ENTITLEMENT_SOURCES]).toEqual([
      "membership",
      "guest",
      "passes",
      "annual",
      "none",
    ]);
  });
});

describe("the routes that read it", () => {
  it("have exactly one local declaration of the row, and it is the shared one", () => {
    // Before the shared reader, /api/live/entitlement and
    // /api/interviews/[id]/live/eligibility each carried their own copy of this
    // type. Two copies of a product's access contract is one too many.
    const entitlement = read("src/app/api/live/entitlement/route.ts");
    const eligibility = read("src/app/api/interviews/[id]/live/eligibility/route.ts");

    for (const [name, source] of [
      ["live/entitlement", entitlement],
      ["live/eligibility", eligibility],
    ] as const) {
      expect(source, `${name} must not declare the row itself`).not.toMatch(
        /type\s+LiveEntitlementRow\s*=/
      );
      for (const stale of SUPERSEDED) {
        // Any occurrence at all, outside a comment, is a caller reading a shape
        // the database no longer returns.
        const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
        expect(code, `${name} still reads ${stale}`).not.toContain(`${stale}:`);
      }
    }
  });

  it("both go through the shared reader", async () => {
    const entitlement = read("src/app/api/live/entitlement/route.ts");
    const eligibility = read("src/app/api/interviews/[id]/live/eligibility/route.ts");

    for (const source of [entitlement, eligibility]) {
      expect(source).toContain("readLiveEntitlement");
      // A direct call to the RPC here would be a fourth, unchecked declaration.
      expect(source).not.toMatch(/rpc\(\s*["']odesseus_get_live_entitlement["']/);
    }
  });

  it("answer a failed check differently, because the two surfaces are different", async () => {
    const entitlement = read("src/app/api/live/entitlement/route.ts");
    const eligibility = read("src/app/api/interviews/[id]/live/eligibility/route.ts");

    // Billing reports the failure (500) rather than implying no access, which
    // would invite a purchase. The interview screen fails closed to the
    // paywall, because a transient error should not deaden the page a candidate
    // is trying to use.
    expect(entitlement).toMatch(/if \(!read\.ok\)[\s\S]*?status: 500/);
    expect(eligibility).toContain("payment_required");
    expect(eligibility).not.toMatch(/if \(!read\.ok\)[\s\S]*?status: 500/);
  });
});
