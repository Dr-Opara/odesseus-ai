import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fakeQueryResult, fromRouter } from "../helpers/fake-supabase";

const createClientMock = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createClient: () => createClientMock(),
}));

const USER_ID = "99999999-9999-4999-8999-000000000001";

function authedClient(from: (table: string) => unknown) {
  return {
    auth: {
      getClaims: vi.fn(async () => ({ data: { claims: { sub: USER_ID } } })),
    },
    from: vi.fn(from),
  };
}

function anonClient() {
  return {
    auth: {
      getClaims: vi.fn(async () => ({ data: { claims: null } })),
    },
  };
}

/**
 * A query-builder stand-in for credit_transactions that supports the wallet
 * service's paged read (.select -> .eq -> .in -> .order -> .range -> await)
 * and resolves with { data, count, error } like PostgREST head-count selects.
 */
function ledgerBuilder(rows: unknown[], total: number, error: unknown = null) {
  const builder: Record<string, unknown> = {};
  builder.select = vi.fn(() => builder);
  builder.eq = vi.fn(() => builder);
  builder.in = vi.fn(() => builder);
  builder.order = vi.fn(() => builder);
  builder.range = vi.fn(() => builder);
  builder.then = (
    resolve: (value: { data: unknown; count: number; error: unknown }) => unknown,
    reject?: (reason: unknown) => unknown
  ) => Promise.resolve({ data: rows, count: total, error }).then(resolve, reject);
  return builder;
}

describe("wallet API routes (balance + paginated ledger)", () => {
  beforeEach(() => {
    createClientMock.mockReset();
  });

  afterEach(() => {
    vi.resetModules();
  });

  it("GET /api/wallet requires a signed-in user", async () => {
    createClientMock.mockResolvedValue(anonClient());

    const { GET } = await import("@/app/api/wallet/route");
    const response = await GET();

    expect(response.status).toBe(401);
  });

  it("GET /api/wallet returns the balance with affordability flags and rates", async () => {
    createClientMock.mockResolvedValue(
      authedClient(fromRouter({
        credit_balances: { wallet_balance_cents: 5000 },
      }))
    );

    const { GET } = await import("@/app/api/wallet/route");
    const response = await GET();
    expect(response.status).toBe(200);

    const body = await response.json();
    expect(body).toEqual({
      wallet_balance_cents: 5000,
      standard_apply_affordable: true,
      smart_apply_affordable: true,
      standard_apply_rate_cents: 49,
      smart_apply_rate_cents: 199,
    });
  });

  it("GET /api/wallet correctly marks the modes a low balance cannot afford", async () => {
    createClientMock.mockResolvedValue(
      authedClient(fromRouter({
        credit_balances: { wallet_balance_cents: 100 },
      }))
    );

    const { GET } = await import("@/app/api/wallet/route");
    const body = await (await GET()).json();

    expect(body.wallet_balance_cents).toBe(100);
    expect(body.standard_apply_affordable).toBe(true);
    expect(body.smart_apply_affordable).toBe(false);
  });

  it("GET /api/wallet maps a missing balance row to zero (still server-authoritative)", async () => {
    createClientMock.mockResolvedValue(authedClient(fromRouter({})));

    const { GET } = await import("@/app/api/wallet/route");
    const body = await (await GET()).json();

    expect(body.wallet_balance_cents).toBe(0);
    expect(body.standard_apply_affordable).toBe(false);
  });

  it("GET /api/wallet returns 500 when the balance lookup fails", async () => {
    createClientMock.mockResolvedValue(
      authedClient(() => fakeQueryResult(null, new Error("boom")))
    );

    const { GET } = await import("@/app/api/wallet/route");
    const response = await GET();

    expect(response.status).toBe(500);
  });

  it("GET /api/wallet/transactions requires a signed-in user", async () => {
    createClientMock.mockResolvedValue(anonClient());

    const { GET } = await import("@/app/api/wallet/transactions/route");
    const response = await GET(
      new Request("http://localhost/api/wallet/transactions")
    );

    expect(response.status).toBe(401);
  });

  it("GET /api/wallet/transactions returns the paginated ledger, wallet types only", async () => {
    const rows = [
      {
        id: "t-1",
        credit_type: "standard_apply",
        delta: -49,
        reason: "successful_application",
        amount_cents: 49,
        balance_cents_after: 4951,
        external_reference: "application:run-1",
        created_at: "2026-09-25T00:00:00Z",
        metadata: { execution_mode: "standard" },
      },
      {
        id: "t-2",
        credit_type: "wallet_topup",
        delta: 5000,
        reason: "stripe_purchase",
        amount_cents: 5000,
        balance_cents_after: 5000,
        external_reference: "evt_topup_1",
        created_at: "2026-09-24T00:00:00Z",
        metadata: { sku: "wallet_50" },
      },
    ];
    createClientMock.mockResolvedValue(
      authedClient((table: string) =>
        table === "credit_transactions"
          ? ledgerBuilder(rows, 2, null)
          : fakeQueryResult(null)
      )
    );

    const { GET } = await import("@/app/api/wallet/transactions/route");
    const response = await GET(
      new Request("http://localhost/api/wallet/transactions?limit=10&offset=0")
    );
    expect(response.status).toBe(200);

    const body = await response.json();
    expect(body.items).toEqual(rows);
    expect(body.total).toBe(2);
    expect(body.limit).toBe(10);
    expect(body.offset).toBe(0);
  });

  it("GET /api/wallet/transactions clamps page size and offset server-side", async () => {
    createClientMock.mockResolvedValue(
      authedClient((table: string) =>
        table === "credit_transactions" ? ledgerBuilder([], 0, null) : fakeQueryResult(null)
      )
    );

    const { GET } = await import("@/app/api/wallet/transactions/route");
    const body = await (
      await GET(new Request("http://localhost/api/wallet/transactions?limit=500&offset=-5"))
    ).json();

    expect(body.limit).toBe(100);
    expect(body.offset).toBe(0);
  });

  it("GET /api/wallet/transactions rejects non-numeric pagination", async () => {
    createClientMock.mockResolvedValue(authedClient(fromRouter({})));

    const { GET } = await import("@/app/api/wallet/transactions/route");
    const response = await GET(
      new Request("http://localhost/api/wallet/transactions?limit=abc")
    );

    expect(response.status).toBe(400);
  });

  it("GET /api/wallet/transactions returns 500 when the ledger lookup fails", async () => {
    createClientMock.mockResolvedValue(
      authedClient((table: string) =>
        table === "credit_transactions"
          ? ledgerBuilder([], 0, new Error("boom"))
          : fakeQueryResult(null)
      )
    );

    const { GET } = await import("@/app/api/wallet/transactions/route");
    const response = await GET(
      new Request("http://localhost/api/wallet/transactions")
    );

    expect(response.status).toBe(500);
  });
});