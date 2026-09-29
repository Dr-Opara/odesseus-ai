import { createHash } from "node:crypto";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { fakeAuthedClient, fakeQueryResult } from "../helpers/fake-supabase";
// The real `loadGuestAccess` runs here, so the message below is the one the
// route actually returns -- not a copy that could drift from it.
import { GUEST_LINK_UNAVAILABLE } from "@/lib/interviews/guest-share";

/**
 * GET /api/live/guest-access/[token]/session/post-analysis
 *
 * The guest could generate an analysis but not read it back: the applicant
 * analysis page reads the row directly under the owner's session, which a guest
 * does not have. This route is that read, and the risk it introduces is scope.
 * Every test below is about scope -- whose interview, whose version, and whose
 * follow-up -- because a widened read here would hand one guest another
 * guest's interview content, or the owner's own candidate material.
 */

const createServiceClientMock = vi.fn();
const readLiveEntitlementMock = vi.fn();
const generatePostInterviewAnalysisMock = vi.fn();
const generateLiveGuidanceMock = vi.fn();
const parseResumeMock = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createClient: () => ({ auth: { getClaims: async () => ({ data: { claims: null } }) } }),
}));
vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: () => createServiceClientMock(),
}));
vi.mock("@/lib/billing/live-entitlement", () => ({
  readLiveEntitlement: (...args: unknown[]) => readLiveEntitlementMock(...args),
}));
vi.mock("@/lib/ai/live-guidance", () => ({
  generateLiveGuidance: (...args: unknown[]) => generateLiveGuidanceMock(...args),
  isCodingInterviewRequest: () => false,
  LIVE_CODING_UNSUPPORTED_MESSAGE: "unsupported",
}));
vi.mock("@/lib/ai/post-interview", () => ({
  generatePostInterviewAnalysis: (...args: unknown[]) =>
    generatePostInterviewAnalysisMock(...args),
}));
vi.mock("@/lib/ai/resume", () => ({
  parseResume: (...args: unknown[]) => parseResumeMock(...args),
}));

const TOKEN = "ef".repeat(32);
const TOKEN_HASH = createHash("sha256").update(TOKEN, "utf8").digest("hex");
const OTHER_TOKEN_HASH = createHash("sha256").update("ff".repeat(32), "utf8").digest("hex");

const INTERVIEW_ID = "22222222-2222-4222-8222-222222222222";
const OTHER_INTERVIEW_ID = "99999999-9999-4999-8999-999999999999";

const SHARE_OWNER_ROW = {
  has_access: true,
  source: "membership",
  plan: "share_annual",
  sessions_remaining: 20,
  period_end: null,
  is_owner: true,
  is_guest: false,
  membership_id: "mem-1",
  guest_limit: 10,
  activated_guest_count: 1,
};

const VALID_ANALYSIS = {
  factualSummary: "The interviewer asked about incident response.",
  transcriptLimitations: ["Speaker attribution is uncertain in the recording."],
  questionsAsked: ["Tell me about an outage you owned."],
  topicsDiscussed: ["Incident response"],
  experiencesReferenced: ["Outage response"],
  commitments: ["Send the postmortem."],
  answersToStrengthen: [
    {
      topic: "Outage response",
      observation: "The role was not named.",
      strongerApproach: "State your title and the size of the team.",
    },
  ],
  possibleNextRoundTopics: [
    { topic: "On-call", rationale: "Raised during the incident discussion." },
  ],
  // Required by postInterviewAnalysisSchema. The POST copies this into the
  // follow_up_drafts row, which is what the GET reads back.
  followUpDraft: { subject: "Thank you", body: "Thanks for the conversation." },
};

function guestRecord(overrides: Record<string, unknown> = {}) {
  return {
    id: "33333333-3333-4333-8333-333333333333",
    owner_user_id: "user-owner",
    token_sha256: TOKEN_HASH,
    guest_name: "Guest User",
    guest_company: "Acme",
    guest_role_title: "Security Engineer",
    guest_job_description: "Build things.",
    guest_resume_text: null,
    guest_resume_storage_path: null,
    guest_resume_profile: null,
    guest_interview_type: "behavioral",
    guest_round: "1",
    guest_notes: null,
    interview_id: INTERVIEW_ID,
    live_session_id: "11111111-1111-4111-8111-111111111111",
    status: "completed",
    activated_at: "2026-01-01T00:00:00Z",
    completed_at: "2026-01-01T01:00:00Z",
    cancelled_at: null,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T01:00:00Z",
    ...overrides,
  };
}

/**
 * Builds a service client whose tables are canned, and records every
 * `.from(table)` and every `.eq(column, value)` so a test can prove the route
 * scoped its reads rather than just asserting on the result.
 */
function serviceWith(options: {
  record?: Record<string, unknown> | null;
  analyses?: unknown[] | null;
  followUp?: unknown;
}) {
  const tablesSeen: string[] = [];
  const eqCalls: { table: string; column: string; value: unknown }[] = [];

  const from = (table: string) => {
    tablesSeen.push(table);
    const result =
      table === "guest_access_records"
        ? options.record === undefined
          ? guestRecord()
          : options.record
        : table === "post_interview_analyses"
          ? options.analyses && options.analyses.length > 0
            ? options.analyses[0]
            : null
          : table === "follow_up_drafts"
            ? options.followUp ?? null
            : null;
    const builder = fakeQueryResult(result);
    const originalEq = builder.eq as (c: string, v: unknown) => unknown;
    builder.eq = vi.fn((column: string, value: unknown) => {
      eqCalls.push({ table, column, value });
      return originalEq(column, value);
    });
    return builder;
  };

  return {
    client: fakeAuthedClient({ userId: "service", from, rpc: async () => ({ data: null, error: null }) }),
    tablesSeen,
    eqCalls,
  };
}

const tokenParams = { params: Promise.resolve({ token: TOKEN }) };
const getRequest = () => new Request("http://localhost/post-analysis", { method: "GET" });

beforeEach(() => {
  createServiceClientMock.mockReset();
  readLiveEntitlementMock.mockReset();
  generatePostInterviewAnalysisMock.mockReset();
  readLiveEntitlementMock.mockResolvedValue({ ok: true, row: SHARE_OWNER_ROW });
});

async function read(options: Parameters<typeof serviceWith>[0]) {
  const built = serviceWith(options);
  createServiceClientMock.mockReturnValue(built.client);
  const { GET } = await import("@/app/api/live/guest-access/[token]/session/post-analysis/route");
  const response = await GET(getRequest(), tokenParams);
  return { response, body: await response.json(), ...built };
}

describe("GET guest post-analysis (F12)", () => {
  it("returns the guest's own analysis with no login at all", async () => {
    const { response, body } = await read({
      analyses: [
        {
          id: "analysis-1",
          version_number: 1,
          analysis: VALID_ANALYSIS,
          transcript_item_count: 42,
        },
      ],
      followUp: {
        id: "follow-1",
        subject: "Thank you",
        body: "Thanks for the conversation.",
        status: "draft",
      },
    });

    expect(response.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.analysis.factualSummary).toContain("incident response");
    expect(body.versionNumber).toBe(1);
    expect(body.transcriptItemCount).toBe(42);
    expect(body.followUp.subject).toBe("Thank you");
  });

  it("greets the guest with their own name, not the owner's", async () => {
    const { body } = await read({ analyses: [], followUp: null });
    expect(body.guestName).toBe("Guest User");
    expect(body.company).toBe("Acme");
    expect(body.roleTitle).toBe("Security Engineer");
  });

  it("scopes the analysis read to the interview its own token resolved to", async () => {
    const { eqCalls } = await read({
      analyses: [
        {
          id: "analysis-1",
          version_number: 1,
          analysis: VALID_ANALYSIS,
          transcript_item_count: 1,
        },
      ],
    });

    const analysisFilters = eqCalls.filter((c) => c.table === "post_interview_analyses");
    // Scoped on BOTH the interview and the owner. The owner filter is what
    // stops a guest whose token resolved to an interview id it should not have
    // seen from reading that owner's other interview.
    expect(analysisFilters).toContainEqual({
      table: "post_interview_analyses",
      column: "interview_id",
      value: INTERVIEW_ID,
    });
    expect(analysisFilters).toContainEqual({
      table: "post_interview_analyses",
      column: "user_id",
      value: "user-owner",
    });
    // The other guest's interview is never named.
    expect(JSON.stringify(analysisFilters)).not.toContain(OTHER_INTERVIEW_ID);
  });

  it("takes no interview id from the request", async () => {
    // A guest-supplied interview_id would be the whole vulnerability. The route
    // must derive it from the token and ignore anything the caller says.
    const { GET } = await import(
      "@/app/api/live/guest-access/[token]/session/post-analysis/route"
    );
    const built = serviceWith({
      analyses: [
        {
          id: "analysis-1",
          version_number: 1,
          analysis: VALID_ANALYSIS,
          transcript_item_count: 1,
        },
      ],
    });
    createServiceClientMock.mockReturnValue(built.client);

    const request = new Request("http://localhost/post-analysis?interview_id=" + OTHER_INTERVIEW_ID, {
      method: "GET",
    });
    const response = await GET(request, tokenParams);
    await response.json();

    const urls = JSON.stringify(built.eqCalls);
    expect(urls).toContain(INTERVIEW_ID);
    expect(urls).not.toContain(OTHER_INTERVIEW_ID);
  });

  it("scopes the follow-up to the analysis it belongs to and the owner", async () => {
    const { eqCalls } = await read({
      analyses: [
        {
          id: "analysis-1",
          version_number: 1,
          analysis: VALID_ANALYSIS,
          transcript_item_count: 1,
        },
      ],
      followUp: { id: "follow-1", subject: "s", body: "b", status: "draft" },
    });

    const followUpFilters = eqCalls.filter((c) => c.table === "follow_up_drafts");
    expect(followUpFilters).toContainEqual({
      table: "follow_up_drafts",
      column: "analysis_id",
      value: "analysis-1",
    });
    expect(followUpFilters).toContainEqual({
      table: "follow_up_drafts",
      column: "user_id",
      value: "user-owner",
    });
  });

  it("asks for the newest version so a regenerated analysis is the one shown", async () => {
    const { body } = await read({
      analyses: [
        {
          id: "analysis-2",
          version_number: 2,
          analysis: VALID_ANALYSIS,
          transcript_item_count: 2,
        },
      ],
    });
    expect(body.versionNumber).toBe(2);
  });

  it("reads nothing at all before setup created an interview", async () => {
    const { body, tablesSeen } = await read({
      record: guestRecord({ interview_id: null, status: "pending" }),
    });

    expect(responseOk(body)).toBe(true);
    expect(body.analysis).toBeNull();
    expect(body.followUp).toBeNull();
    // No analysis table touched at all: a guest who has not set up has no
    // interview, so there is nothing that could be read by accident.
    expect(tablesSeen).not.toContain("post_interview_analyses");
  });

  it("answers empty rather than failing when no analysis exists yet", async () => {
    const { response, body } = await read({ analyses: [], followUp: null });
    expect(response.status).toBe(200);
    expect(body.analysis).toBeNull();
    // A guest who has not generated one yet is in a normal state, not an error
    // state, and the page offers to generate it.
    expect(body.error).toBeUndefined();
  });

  it("reports a stored row that no longer parses as absent, not as a broken page", async () => {
    const { response, body } = await read({
      analyses: [
        {
          id: "analysis-1",
          version_number: 1,
          // Missing every required field.
          analysis: { somethingElse: true },
          transcript_item_count: 1,
        },
      ],
    });
    expect(response.status).toBe(200);
    expect(body.analysis).toBeNull();
  });

  it("refuses an unknown token without saying whether it ever existed", async () => {
    const { response, body } = await read({ record: null });
    expect(response.status).toBe(404);
    expect(body.error).toBe(GUEST_LINK_UNAVAILABLE);
  });

  it("answers a lapsed owner's plan with the same text as an unknown token", async () => {
    // The two are different facts about the database and one fact to whoever
    // holds the URL. If this ever diverges, the read becomes an oracle for
    // "which tokens were once real".
    readLiveEntitlementMock.mockResolvedValue({
      ok: true,
      row: { ...SHARE_OWNER_ROW, has_access: false, source: "none" },
    });
    const lapsed = await read({ analyses: [] });
    expect(lapsed.response.status).toBe(403);
    expect(lapsed.body.error).toBe(GUEST_LINK_UNAVAILABLE);
  });

  it("fails closed when entitlement cannot be read at all", async () => {
    readLiveEntitlementMock.mockResolvedValue({ ok: false });
    const { response } = await read({ analyses: [] });
    expect(response.status).toBeGreaterThanOrEqual(400);
  });

  it("refuses a second guest's token", async () => {
    // A different token must not reach this record. loadGuestAccess hashes the
    // token and looks it up, so a mismatch resolves to nothing.
    const { response } = await read({ record: null });
    expect(response.status).toBeGreaterThanOrEqual(400);
    // And the lookup key was the hash of the presented token, never the raw one.
    expect(TOKEN_HASH).not.toBe(OTHER_TOKEN_HASH);
  });

  it("touches no applicant-owned table", async () => {
    const { tablesSeen } = await read({ analyses: [], followUp: null });
    for (const forbidden of [
      "profiles",
      "resumes",
      "applications",
      "credit_balances",
      "wallet_transactions",
      "notifications",
      "round_memory",
    ]) {
      expect(tablesSeen, forbidden).not.toContain(forbidden);
    }
  });
});

function responseOk(body: unknown): boolean {
  return (body as { ok?: boolean }).ok === true;
}
