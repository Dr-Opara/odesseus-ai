/**
 * Shared result shape for every employer adapter, modeled directly on
 * `WalletResult<T>` (src/lib/wallet/adapter.ts): an explicit "unavailable"
 * result instead of a fabricated value. `source` lets pages/tests assert
 * fixture-vs-live without any UI component branching on it — components only
 * ever look at `status`/`data`.
 */
export type EmployerResult<T> =
  | { status: "ok"; data: T; source: "live" | "fixture" }
  | { status: "unavailable"; reason: string };
