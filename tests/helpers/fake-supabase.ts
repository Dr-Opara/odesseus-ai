import { vi } from "vitest";

// A minimal stand-in for a Supabase PostgREST query builder. Every
// filter/modifier method returns the same chainable object; the object
// itself is thenable so `await service.from(x).update(y).eq(z)` resolves
// even when no terminal method like .single()/.maybeSingle() is called,
// matching real supabase-js query builder behavior.
export function fakeQueryResult<T = unknown>(data: T, error: unknown = null) {
  const result = { data, error };
  const builder: Record<string, unknown> = {};
  const chainMethods = [
    "select",
    "eq",
    "neq",
    "in",
    "order",
    "limit",
    "or",
    "insert",
    "update",
    "upsert",
    "delete",
  ];
  for (const method of chainMethods) {
    builder[method] = vi.fn(() => builder);
  }
  builder.maybeSingle = vi.fn(() => Promise.resolve(result));
  builder.single = vi.fn(() => Promise.resolve(result));
  builder.then = (
    resolve: (value: typeof result) => unknown,
    reject?: (reason: unknown) => unknown
  ) => Promise.resolve(result).then(resolve, reject);
  return builder;
}

export function fakeAuthedClient(opts: {
  userId?: string | null;
  from?: (table: string) => unknown;
  rpc?: (...args: unknown[]) => Promise<unknown>;
}) {
  return {
    auth: {
      getClaims: vi.fn(async () => ({
        data: opts.userId ? { claims: { sub: opts.userId } } : { claims: null },
      })),
    },
    from: vi.fn(opts.from || (() => fakeQueryResult(null))),
    rpc: vi.fn(opts.rpc || (async () => ({ data: null, error: null }))),
    storage: {
      from: vi.fn(() => ({
        createSignedUrl: vi.fn(async () => ({ data: { signedUrl: "https://example.com/signed" }, error: null })),
        remove: vi.fn(async () => ({ data: null, error: null })),
      })),
    },
  };
}

// Routes a `.from(table)` call to a per-table canned result, so a test can
// configure only the tables it cares about without hand-writing a switch
// statement each time.
export function fromRouter(tableResults: Record<string, unknown>, fallback: unknown = null) {
  return (table: string) => fakeQueryResult(tableResults[table] ?? fallback);
}
