import { describe, expect, it } from "vitest";
import {
  applicationCreditReference,
  liveInterviewCreditReference,
} from "@/lib/billing/credit-references";

describe("applicationCreditReference", () => {
  it("is deterministic for the same application run id", () => {
    const runId = "11111111-1111-1111-1111-111111111111";
    expect(applicationCreditReference(runId)).toBe(applicationCreditReference(runId));
  });

  it("produces a distinct reference per application run id", () => {
    const a = applicationCreditReference("run-a");
    const b = applicationCreditReference("run-b");
    expect(a).not.toBe(b);
  });

  it("namespaces the reference so it cannot collide with a live-interview reference for the same id", () => {
    const id = "shared-id";
    expect(applicationCreditReference(id)).not.toBe(liveInterviewCreditReference(id));
  });
});

describe("liveInterviewCreditReference", () => {
  it("is deterministic for the same live session id, matching the odysseus_activate_live_session RPC's convention", () => {
    const sessionId = "22222222-2222-2222-2222-222222222222";
    expect(liveInterviewCreditReference(sessionId)).toBe(`live:${sessionId}`);
    expect(liveInterviewCreditReference(sessionId)).toBe(
      liveInterviewCreditReference(sessionId)
    );
  });
});
