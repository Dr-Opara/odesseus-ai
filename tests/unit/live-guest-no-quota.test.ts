import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";

/**
 * Live Share has no guest cap.
 *
 * A retired quota model left five places in the codebase that still depended on
 * `live_memberships.guest_limit`, and one of them was an authorization gate:
 * `odesseus_create_live_guest_invite` raised unless `guest_limit >= 1`. Because
 * the column defaults to 0, a Share Annual membership created without an
 * explicit limit could not issue a single invitation -- a paying customer
 * silently denied, inside the database, where no HTTP-level test reaches it.
 *
 * A test that sets `guest_limit = 10` passes whether or not that gate exists, so
 * the behaviour cannot be pinned by running a flow. It has to be pinned by
 * asserting the absence, which is what this file does.
 *
 * These assertions are deliberately structural rather than behavioural: the
 * failure mode being guarded against is a *reintroduction*, and a reintroduction
 * looks like code that reads the retired column, not like a test that fails.
 */

const ROOT = resolve(process.cwd());
const MIGRATIONS = join(ROOT, "supabase", "migrations");

/** Every source file that is not a migration, so history is not policed here. */
function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === "node_modules" || entry === ".next" || entry === "migrations") continue;
      sourceFiles(full, out);
    } else if (/\.(ts|tsx|mjs)$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

const SOURCES = sourceFiles(ROOT).filter((f) => !f.includes(join("supabase", "migrations")));
const read = (file: string) => readFileSync(file, "utf8");

/**
 * The file with its comments removed.
 *
 * Everything this file asserts about a retired name has to look at code rather
 * than at prose. The migration has to be able to say which clause it removed and
 * why, the accept route has to be able to say which status it no longer maps, and
 * the catalog has to be able to explain that no allowance constant exists. Those
 * are all correct, all mention the retired name, and an assertion that cannot
 * tell a comment from an expression will fail on exactly the files that did the
 * work.
 *
 * Handles both `--` line comments and `/* *\/` blocks, which between them cover
 * TypeScript, SQL and the migration. String literals are not preserved, so a
 * regex match inside one is treated as prose -- acceptable, since none of the
 * retired names belong in a user-facing string either.
 */
function codeOnly(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .split("\n")
    .map((line) => line.replace(/^\s*(--|\/\/)[\s\S]*$/, ""))
    .join("\n");
}

/**
 * The file's prose: comment text with the comment syntax removed.
 *
 * For asserting that a comment *says* something. Collapsing whitespace alone is
 * not enough, because the block-comment leader survives it -- a sentence wrapped
 * inside `/* ... *\/` comes out as "are abuse * protection", so a phrase the
 * author never broke fails to match. The leaders go, the words stay.
 */
function proseOf(source: string): string {
  return source
    .replace(/\/\*([\s\S]*?)\*\//g, (_m, body: string) => body)
    .replace(/^\s*\*\s?/gm, " ")
    .replace(/\/\/[^\n]*/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Every line in the file that is code and mentions a retired guest term. */
function retiredTermLines(file: string): string[] {
  return codeOnly(read(file))
    .split("\n")
    .map((line, i) => ({ line: line.trim(), n: i + 1 }))
    .filter(({ line }) => line && /guest_limit|guest_count|activated_guest_count|guest_remaining/.test(line))
    .map(({ line, n }) => `${relative(ROOT, file)}  ${line.slice(0, 100)}`);
}

describe("no guest allowance constant exists", () => {
  it("the billing catalog exports no guest limit", async () => {
    const catalog = await import("@/lib/billing/catalog");
    // It used to be load-bearing: the TypeScript mirror of the database's
    // enforcement. Both are gone, and a constant left behind would look
    // authoritative while describing nothing.
    expect(catalog).not.toHaveProperty("LIVE_SHARE_GUEST_LIMIT");
  });

  it("no product description mentions guest places or slots", async () => {
    const { billingCatalog } = await import("@/lib/billing/catalog");
    for (const [sku, entry] of Object.entries(billingCatalog)) {
      expect(`${sku}: ${entry.description}`, `guest places or slots in ${sku}`).not.toMatch(
        /guest\s+(places?|slots?)/i
      );
    }
  });

  it("the catalog source states the absence and points at what does authorize", () => {
    const source = read(join(ROOT, "src", "lib", "billing", "catalog.ts"));
    expect(source).toContain("no guest allowance constant");
    expect(source).toContain("canGenerateGuestLinks");
    // The throttle is abuse protection; saying so is what stops the next reader
    // from mistaking it for the quota that used to exist.
    // Read the prose with the comment syntax removed, so the assertion is about
    // what the comment says rather than about where it happens to wrap.
    const prose = proseOf(source);
    expect(prose).toMatch(/rate limits[^.]*abuse protection/i);
    expect(prose).toMatch(/not a commercial quota/i);
  });
});

describe("authorization reads the plan, not a guest count", () => {
  it("canGenerateGuestLinks is plan-only", () => {
    const source = read(join(ROOT, "src", "lib", "interviews", "guest-share.ts"));
    const body = source.slice(
      source.indexOf("export function canGenerateGuestLinks"),
      source.indexOf("export function canGenerateGuestLinks") + 400
    );
    expect(body).toContain("row.has_access");
    expect(body).toContain("row.is_owner");
    expect(body).toContain('row.plan === "share_annual"');
    // A quota term here would mean the gate reads a number, which is the exact
    // shape of the bug this file exists to keep out.
    expect(body).not.toMatch(/guest_limit|guest_count|activated_guest_count|remaining/i);
  });

  it("no application source reads guest_limit or guest_count at all", () => {
    // The columns are historical. Nothing in application code should touch them,
    // so this is a blanket sweep rather than a list of known-good call sites: a
    // new one has to be argued for rather than inherited.
    //
    // Tests are excluded because this file, and the Task 8 harness, deliberately
    // name the retired columns to prove they are unused.
    // Two files may name them, and the exception is named rather than implied:
    // an unnamed allowlist is how a sweep quietly stops sweeping.
    const ALLOWED: Record<string, string> = {
      // The RPC still returns the columns, so the type that describes its result
      // has to declare them. It marks them HISTORICAL and the module comment says
      // nothing authorizes on them, which is asserted separately below.
      "live-entitlement.ts": "declares the RPC's result shape; marked HISTORICAL",
      // Generated from the live schema. The columns still exist, so the generated
      // types still describe them. Regenerating this file is the only way they
      // change, and it must not be hand-edited to match an assertion.
      "database.ts": "generated from the schema; the columns still exist",
    };

    const offenders: string[] = [];
    for (const file of SOURCES) {
      const base = file.split(/[\\/]/).pop() ?? file;
      if (ALLOWED[base]) continue;
      // Tests are excluded: this file and the Task 8 harness deliberately name
      // the retired columns to prove they are unused.
      if (file.includes(`${join("tests", "")}`) || file.includes("local-flow-")) continue;
      offenders.push(...retiredTermLines(file));
    }
    expect(offenders, "application code still touching the retired guest columns").toEqual([]);
  });

  it("the entitlement contract declares the columns historical rather than using them", () => {
    // The one application file allowed to name them, because the RPC still
    // returns them and the type has to describe what comes back. What it must not
    // do is treat them as part of the contract, so they are marked and the
    // surrounding doc says nothing authorizes on them.
    const source = read(join(ROOT, "src", "lib", "billing", "live-entitlement.ts"));
    expect(source).toContain("HISTORICAL");
    expect(proseOf(source)).toMatch(/nothing authorizes on them/i);
  });
});

describe("the API does not surface a guest allowance", () => {
  const ROUTES = [
    "src/app/api/live/guests/route.ts",
    "src/app/api/live/entitlement/route.ts",
    "src/app/api/live/guests/accept/route.ts",
  ];

  it.each(ROUTES)("%s returns no quota field and refuses no caller for one", (rel) => {
    // The response body is what a client reads, so this is the surface that
    // matters. Comments are stripped because each of these routes has to be able
    // to explain why it reports no allowance.
    const code = codeOnly(read(join(ROOT, rel)));
    expect(code, rel).not.toMatch(
      /guest_limit|guest_count|guest_places_remaining|max_guests_per_year|guest_remaining|guestLimit|maxGuestsPerYear/
    );
  });

  it("no route refuses a caller for having used up a guest allowance", () => {
    const offenders: string[] = [];
    for (const file of sourceFiles(join(ROOT, "src", "app", "api"))) {
      const code = codeOnly(read(file));
      if (/guest limit reached|guest slots for this|all of its guest/i.test(code)) {
        offenders.push(relative(ROOT, file));
      }
    }
    expect(offenders, "routes still refusing on a retired quota").toEqual([]);
  });

  it("the accept route's status map has no entry for a refusal nobody can produce", () => {
    const source = read(join(ROOT, "src", "app", "api", "live", "guests", "accept", "route.ts"));
    // Keeping a mapped status for it would invite a caller to keep handling a
    // limit that no longer exists. The comment explaining the absence may name
    // it; the code may not.
    expect(codeOnly(source)).not.toContain("guest_limit_reached");
  });
});

describe("the database can no longer express the retired quota", () => {
  const MIGRATION = "20261121000000_retire_live_guest_quota.sql";
  const migration = read(join(MIGRATIONS, MIGRATION));

  it("drops the trigger, the function and both CHECK constraints", () => {
    expect(migration).toContain("DROP TRIGGER IF EXISTS live_guest_entitlements_cap");
    expect(migration).toContain("DROP FUNCTION IF EXISTS odesseus_private.enforce_live_guest_cap()");
    expect(migration).toContain("DROP CONSTRAINT IF EXISTS live_memberships_guest_count_within_limit");
    expect(migration).toContain("DROP CONSTRAINT IF EXISTS live_memberships_personal_has_no_guests");
  });

  it("removes the guest_limit gate from the invitation RPC", () => {
    // The single most consequential line in the reconciliation: this clause made
    // a historical column an authorization input, and a Share membership with the
    // default 0 could not invite anybody.
    expect(migration).toContain("odesseus_create_live_guest_invite");
    // The migration has to be able to quote the clause it removed, so the
    // assertion is about executable SQL.
    expect(codeOnly(migration)).not.toContain("v_membership.guest_limit < 1");
    expect(migration).toContain("if v_membership.plan_type <> 'share_annual' then");
  });

  it("decouples the three bookkeeping functions from the retired column", () => {
    // Each of these read guest_limit and skipped its work when it was zero, so
    // removing the catalog key without this would have left counters and history
    // quietly stale.
    const code = codeOnly(migration);
    // None of the three `guest_limit > 0` / `< 1` guards survives in executable
    // SQL. They may be quoted in prose, which is how the migration explains
    // what changed.
    expect(code).not.toMatch(/and m\.guest_limit > 0/);
    expect(code).not.toMatch(/new\.guest_limit < 1 then\s+return new/i);
    expect(code).not.toMatch(/v_is_renewal and v_guest_limit > 0/);
    // And the work each of them gated is present unconditionally.
    expect(code).toContain("if v_is_renewal then");
    expect(code).toContain("SET status = 'expired'");
  });

  it("strips the guest_limit key from the reference catalog rather than zeroing it", () => {
    // Zero is a value, and it would read as "this plan includes no guests" --
    // as wrong as ten, in the other direction.
    expect(migration).toContain("metadata - 'guest_limit'");
    expect(migration).not.toMatch(/set\s+metadata\s*=\s*jsonb_set[\s\S]{0,120}guest_limit[\s\S]{0,40}\b0\b/);
  });

  it("retains the historical columns and says so on the objects themselves", () => {
    expect(migration).toContain("COMMENT ON COLUMN public.live_memberships.guest_limit IS");
    expect(migration).toContain("COMMENT ON COLUMN public.live_memberships.guest_count IS");
    // And says why the two bookkeeping triggers stay: they enforce nothing.
    expect(migration).toContain("Bookkeeping only");
  });

  it("never drops a table or a column", () => {
    // "Do not remove historical DB fields blindly": the rows have real history
    // and real foreign keys. Only the enforcement goes.
    expect(migration).not.toMatch(/drop\s+table/i);
    expect(migration).not.toMatch(/drop\s+column/i);
  });
});