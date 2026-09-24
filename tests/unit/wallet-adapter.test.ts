import { describe, expect, it } from "vitest";
import {
  getWalletBalance,
  listWalletTransactions,
  requestWalletTopUp,
} from "@/lib/wallet/adapter";

describe("wallet adapter", () => {
  it("honestly reports that the balance API is not available yet instead of fabricating a balance", async () => {
    const result = await getWalletBalance();
    expect(result.status).toBe("unavailable");
    if (result.status === "unavailable") {
      expect(result.reason).toMatch(/not yet available/i);
    }
  });

  it("honestly reports that transaction history is not available yet instead of returning fake activity", async () => {
    const result = await listWalletTransactions();
    expect(result.status).toBe("unavailable");
    if (result.status === "unavailable") {
      expect(result.reason).toMatch(/not yet available/i);
    }
  });

  it("never fabricates a checkout URL for a top-up while the wallet API is missing", async () => {
    const result = await requestWalletTopUp(2000);
    expect(result.status).toBe("unavailable");
  });

  it("echoes the requested top-up amount in the unavailable reason", async () => {
    const result = await requestWalletTopUp(5000);
    expect(result.status).toBe("unavailable");
    if (result.status === "unavailable") {
      expect(result.reason).toContain("5000");
    }
  });

  it("exposes the same not-yet-available stance for each advertised top-up amount", async () => {
    for (const amountCents of [1000, 2000, 5000]) {
      const result = await requestWalletTopUp(amountCents);
      expect(result.status).toBe("unavailable");
      if (result.status === "unavailable") {
        expect(result.reason).toContain(String(amountCents));
      }
    }
  });
});