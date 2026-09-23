import { vi } from "vitest";
import { fakeAuthedClient } from "./fake-supabase";

export type PricedRow = Record<string, unknown>;

/**
 * A filter-aware fake Supabase client for the pricing engine.
 *
 * Unlike the generic `fakeQueryResult` (which returns the same canned result
 * for every terminal call), this builder applies the real `.eq()` filters to
 * its per-table rows, so tests like "mapped market differs from the fallback
 * market" behave correctly without hand-rolled switch statements.
 */
export function fakePricingClient(opts: {
  userId?: string | null;
  tables?: Record<string, PricedRow[]>;
  failTables?: string[];
}) {
  const tables = opts.tables ?? {};
  const failTables = new Set(opts.failTables ?? []);

  const from = (table: string) => {
    const rows = tables[table] ?? [];
    const eqFilters: Array<[string, unknown]> = [];
    const builder: Record<string, unknown> = {};

    const matches = () =>
      rows.filter((row) =>
        eqFilters.every(([column, value]) => row[column] === value)
      );

    builder.select = vi.fn(() => builder);
    builder.eq = vi.fn((column: string, value: unknown) => {
      eqFilters.push([column, value]);
      return builder;
    });
    builder.order = vi.fn(() => builder);
    builder.limit = vi.fn(() => builder);
    builder.maybeSingle = vi.fn(async () => {
      if (failTables.has(table)) {
        return { data: null, error: { message: "db unavailable" } };
      }
      const [first] = matches();
      return { data: first ?? null, error: null };
    });
    builder.then = (
      resolve: (value: { data: PricedRow[]; error: null | { message: string } }) => unknown,
      reject?: (reason: unknown) => unknown
    ) => {
      if (failTables.has(table)) {
        return Promise.resolve({ data: [], error: { message: "db unavailable" } }).then(reject);
      }
      return Promise.resolve({ data: matches(), error: null }).then(resolve, reject);
    };

    return builder;
  };

  return fakeAuthedClient({ userId: opts.userId ?? null, from });
}