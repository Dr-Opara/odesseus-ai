/** INTEGRATION POINT — employer analytics backend (OpenCode Phase 2P-2S, not yet shipped). */
import { isProductionRuntime } from "@/lib/config/runtime";
import { EMPLOYER_ANALYTICS_FIXTURE } from "./fixtures/analytics";
import type { EmployerAnalyticsSnapshot } from "./types";
import type { EmployerResult } from "./result";

export async function getEmployerAnalytics(): Promise<EmployerResult<EmployerAnalyticsSnapshot>> {
  if (isProductionRuntime()) {
    return { status: "unavailable", reason: "Employer analytics API is not yet available." };
  }
  return { status: "ok", data: EMPLOYER_ANALYTICS_FIXTURE, source: "fixture" };
}
