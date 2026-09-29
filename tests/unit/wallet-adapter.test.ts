import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Candidate wallet adapter contracts.
 *
 * This file used to assert that every wallet function returned `unavailable`
 * with a "not yet available" reason, which described a wallet backend that did
 * not exist. It does now (`src/lib/wallet/service.ts`, exposed through
 * `/api/wallet*`), so the reads are wired and only the top-up remains
 * deliberately un-implemented.
 *
 * The reads need a live database, so their behaviour is covered by
 * `tests/integration/wallet-api.test.ts`. What is asserted here is the
 * property that protects a candidate's money, and that needs no database:
 *
 *  1. **A top-up is never a local state change.** It is a Stripe checkout, and
 *     the webhook is what credits the wallet. If this module ever grew a
 *     "pretend charge", a browser could grant itself Apply money — the exact
 *     self-grant the wallet rules forbid.
 *  2. **No balance is defaulted.** A failed read must read as a failure, not
 *     as $0. Telling a candidate with money in their wallet that they have
 *     none is a false statement about their own balance.
 */

import { getWalletBalance, listWalletTransactions, requestWalletTopUp } from "@/lib/wallet/adapter";

const adapterSource = readFileSync(
  join(process.cwd(), "src", "lib", "wallet", "adapter.ts"),
  "utf8"
);

describe("a wallet top-up is a purchase, never a local write", () => {
  it("reports unavailable rather than fabricating a checkout URL", async () => {
    const result = await requestWalletTopUp(2000);
    expect(result.status).toBe("unavailable");
  });

  it("echoes the requested amount so the refusal is specific", async () => {
    const result = await requestWalletTopUp(5000);
    expect(result.status).toBe("unavailable");
    if (result.status === "unavailable") {
      expect(result.reason).toContain("5000");
    }
  });

  it("does the same for each advertised top-up amount", async () => {
    for (const amountCents of [1000, 2000, 5000]) {
      const result = await requestWalletTopUp(amountCents);
      expect(result.status).toBe("unavailable");
      if (result.status === "unavailable") {
        expect(result.reason).toContain(String(amountCents));
      }
    }
  });

  it("never writes a balance or a credit transaction from the client side", () => {
    // A `wallet_balance_cents` write or a `credit_transactions` insert in this
    // module would be a browser-mintable balance. The reads are the only thing
    // that may touch those tables, and only to select.
    expect(adapterSource).not.toMatch(/\.insert\(/);
    expect(adapterSource).not.toMatch(/\.update\(/);
    expect(adapterSource).not.toMatch(/\.upsert\(/);
  });
});

describe("no balance is ever defaulted", () => {
  it("reads the balance from the wallet service rather than returning a literal zero", () => {
    // The module must call the backend read. A `balanceCents: 0` fallback
    // would render as a real balance and be indistinguishable from one.
    expect(adapterSource).toContain("getWalletBalance");
    expect(adapterSource).toContain("wallet_balance_cents");
    expect(adapterSource).not.toMatch(/balanceCents:\s*0\b/);
  });

  it("returns a reason with every unavailable read, so a failure is not an empty balance", () => {
    expect(adapterSource).toMatch(/status:\s*"unavailable",\s*\n?\s*reason:/);
  });
});

describe("the wallet reads are server-side", () => {
  it("uses the session-scoped client, so RLS scopes the read to the caller", () => {
    expect(adapterSource).toContain("@/lib/supabase/server");
  });

  it("reads the user's own id from the session rather than a parameter", () => {
    // A `userId` argument would let a caller name another candidate's wallet.
    const signatures = adapterSource.match(
      /export async function \w+\([^)]*\)/g
    ) ?? [];
    for (const signature of signatures) {
      expect(signature).not.toMatch(/userId/);
    }
  });
});

describe("the adapter is not imported by a client component", () => {
  it("no client component reads the wallet through it", () => {
    // The adapter opens a session-scoped Supabase client, so importing it
    // from a client component would pull `next/headers` into the browser
    // bundle and fail the build.
    expect(adapterSource).toContain("@/lib/supabase/server");
    // The reads are called from server components only; assert no
    // `"use client"` file references this module.
    const offenders: string[] = [];
    for (const relative of [
      "src/components/wallet",
      "src/app/billing",
    ]) {
      let files: string[] = [];
      try {
        files = require("node:fs").readdirSync(join(process.cwd(), relative));
      } catch {
        continue;
      }
      for (const file of files) {
        if (!file.endsWith(".tsx")) continue;
        const source = readFileSync(join(process.cwd(), relative, file), "utf8");
        if (source.startsWith('"use client"') && source.includes("wallet/adapter")) {
          offenders.push(`${relative}/${file}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});

describe("the real wallet surface is the billing page", () => {
  it("/billing reads the wallet from the database and starts real checkouts", () => {
    // The orphan WalletPanel that duplicated this was removed. The billing
    // page is the one candidate wallet surface: it reads the real balance and
    // ledger, and its top-ups are the catalog's checkout SKUs.
    const source = readFileSync(join(process.cwd(), "src", "app", "billing", "page.tsx"), "utf8");
    expect(source).toContain("credit_balances");
    expect(source).toContain("createCheckoutSession");
    expect(source).toContain("wallet_10");
  });
});
