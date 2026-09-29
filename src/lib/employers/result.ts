/**
 * Shared result shape for every employer adapter, modeled directly on
 * `WalletResult<T>` (src/lib/wallet/adapter.ts): an explicit "unavailable"
 * result instead of a fabricated value.
 *
 * `source` is a single-valued marker, not a choice. It used to be
 * `"live" | "fixture"`, back when the adapters returned development fixtures
 * outside production — which meant a production build could silently serve
 * invented companies, applicants, and seat counts to a signed-in employer.
 * Every adapter now reads the real backend, so the only source left is `live`.
 * Narrowing the union to one member makes reintroducing a fixture path a
 * compile error rather than a code review question.
 *
 * Components only ever look at `status`/`data`; nothing branches on `source`.
 */
export type EmployerResult<T> =
  | { status: "ok"; data: T; source: "live" }
  | { status: "unavailable"; reason: string };
