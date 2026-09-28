import { describe, expect, it, vi } from "vitest";
import { getCandidateDashboard } from "@/lib/candidate/dashboard";
import { fakeAuthedClient, fromRouter } from "../helpers/fake-supabase";
import type { CandidateClient } from "@/lib/candidate/service";

const USER = "11111111-1111-4111-8111-111111111111";

/** A counts row as PostgREST returns it: bigint columns arrive as strings. */
const COUNTS = {
  jobs_discovered: "412",
  jobs_strong_matches: "3",
  jobs_saved: "7",
  jobs_reviewing: "2",
  applications_total: "9",
  applications_submitted: "5",
  applications_verified: "4",
  queue_total: "1",
  queue_in_flight: "0",
  queue_needs_review: "1",
  queue_needs_input: "0",
  queue_held: "0",
  queue_failed: "2",
  interviews_total: "3",
  interviews_upcoming: "1",
  interviews_completed: "2",
  prep_generated: "2",
  prep_last_generated_at: "2026-10-20T09:00:00.000Z",
  resumes_total: "2",
  resumes_approved: "1",
  has_primary_resume: true,
  agent_decisions_today: "0",
};

/**
 * Builds a client whose `rpc` and `from` are the shared fakes.
 *
 * The returned `client` is what the service is handed, so assertions about
 * "was the RPC called with this threshold" must be made against the client's own
 * `rpc` mock. `fakeAuthedClient` wraps a supplied implementation in its own
 * `vi.fn`, so a spy captured before that point records nothing.
 */
function client(opts: {
  counts?: Record<string, unknown>[] | null;
  tables?: Record<string, unknown>;
  rpcError?: unknown;
} = {}) {
  const counts = opts.counts === undefined ? [COUNTS] : opts.counts;
  const built = fakeAuthedClient({
    userId: USER,
    rpc: async () => ({ data: counts, error: opts.rpcError ?? null }),
    from: fromRouter(opts.tables ?? {}),
  }) as unknown as CandidateClient;

  return {
    client: built,
    /** The service-visible `rpc` mock, which is the one with the call recorded. */
    rpc: (built as unknown as { rpc: ReturnType<typeof vi.fn> }).rpc,
  };
}

const emptyTables = {
  profiles: null,
  application_agent_settings: null,
  credit_balances: null,
  credit_transactions: [],
  applications: [],
  interviews: [],
  candidate_activity_events: [],
  resumes: null,
  job_preferences: null,
  job_opportunities: [],
};

describe("getCandidateDashboard", () => {
  it("requires a user id", async () => {
    const { client: c } = client();
    await expect(getCandidateDashboard(c, "")).rejects.toThrow(/user id is required/);
  });

  it("reports a candidate who has done nothing as all zeroes, not an error", async () => {
    // The first-run dashboard is the most common case in the product: a new
    // candidate with no resume, no jobs, no money. It must render.
    const { client: c } = client({
      counts: [{}],
      tables: { ...emptyTables, job_preferences: null },
    });
    const dash = await getCandidateDashboard(c, USER);

    expect(dash.counts.jobsDiscovered).toBe(0);
    expect(dash.counts.strongMatches).toBe(0);
    expect(dash.counts.queueTotal).toBe(0);
    expect(dash.counts.resumesApproved).toBe(0);
    expect(dash.counts.hasPrimaryResume).toBe(false);
    expect(dash.counts.prepLastGeneratedAt).toBeNull();
    expect(dash.agent).toBeNull();
    expect(dash.wallet.balanceCents).toBe(0);
    expect(dash.wallet.canApply).toBe(false);
    expect(dash.resume.ready).toBe(false);
    expect(dash.resume.primaryResumeId).toBeNull();
    expect(dash.activity).toEqual([]);
    expect(dash.needsAttention).toEqual([]);
    expect(dash.recentApplications).toEqual([]);
    expect(dash.upcomingInterviews).toEqual([]);
  });

  it("reports zeroes when the counts RPC returns nothing at all", async () => {
    // A missing row is a real possibility and must not produce NaN anywhere in
    // the payload, which is what a bare `Number(undefined)` would do.
    const { client: c } = client({ counts: [], tables: emptyTables });
    const dash = await getCandidateDashboard(c, USER);

    for (const [key, value] of Object.entries(dash.counts)) {
      if (key === "prepLastGeneratedAt") {
        expect(value).toBeNull();
      } else if (key === "hasPrimaryResume") {
        expect(value).toBe(false);
      } else {
        expect(Number.isNaN(value as number)).toBe(false);
        expect(value).toBe(0);
      }
    }
  });

  it("converts a bigint string to a number", async () => {
    const { client: c } = client({ tables: emptyTables });
    const dash = await getCandidateDashboard(c, USER);
    expect(dash.counts.jobsDiscovered).toBe(412);
    expect(dash.counts.strongMatches).toBe(3);
  });

  it("counts nothing it was not told about: no row caps touch a count", async () => {
    // The defect this replaces counted a 5-row job fetch. The counts here come
    // from the RPC alone, so the only proof available is that the RPC is what
    // produced them.
    const { client: c, rpc } = client({ tables: emptyTables });
    const dash = await getCandidateDashboard(c, USER);

    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith("odesseus_get_candidate_dashboard_counts", {
      p_user_id: USER,
      p_strong_match_threshold: 85,
    });
    expect(dash.counts.jobsDiscovered).toBe(412);
  });

  it("passes the candidate's own match threshold, not the default", async () => {
    // The whole point of reading the preference is that a candidate who set
    // 70 sees the same strong-match number on the dashboard as in the job list.
    const { client: c, rpc } = client({
      tables: { ...emptyTables, job_preferences: { min_match_score: 70 } },
    });
    await getCandidateDashboard(c, USER);
    expect(rpc).toHaveBeenCalledWith("odesseus_get_candidate_dashboard_counts", {
      p_user_id: USER,
      p_strong_match_threshold: 70,
    });
  });

  it("falls back to the default threshold when there is no preferences row", async () => {
    const { client: c, rpc } = client({ tables: emptyTables });
    await getCandidateDashboard(c, USER);
    expect(rpc).toHaveBeenCalledWith("odesseus_get_candidate_dashboard_counts", expect.objectContaining({ p_strong_match_threshold: 85 }));
  });

  it("ignores a nonsensical stored threshold rather than sending it on", async () => {
    const { client: c, rpc } = client({
      tables: { ...emptyTables, job_preferences: { min_match_score: null } },
    });
    await getCandidateDashboard(c, USER);
    expect(rpc).toHaveBeenCalledWith("odesseus_get_candidate_dashboard_counts", expect.objectContaining({ p_strong_match_threshold: 85 }));
  });

  it("reads nothing from a provider-integration table", async () => {
    // The requirement that the dashboard is native Odesseus data only, asserted
    // against the call log rather than against a comment in the source.
    const { client: c } = client({ tables: emptyTables });
    await getCandidateDashboard(c, USER);

    const queried = (c.from as unknown as { mock: { calls: string[][] } }).mock.calls.map(
      (call) => call[0]
    );
    expect(queried).not.toContain("external_signals");
    expect(queried).not.toContain("application_status_events");
    expect(queried).not.toContain("integration_accounts");
    expect(queried).not.toContain("integration_connections");
  });

  it("fails loudly rather than returning a dashboard with a missing section", async () => {
    // A silent omission would read as "you have no money" or "you have no
    // applications", which is worse than an error the candidate can retry.
    const { client: c } = client({
      rpcError: { message: "boom" },
      tables: emptyTables,
    });
    await expect(getCandidateDashboard(c, USER)).rejects.toThrow(/dashboard counts/);
  });

  it("fails when the preferences read fails, before spending a counts call", async () => {
    const c = fakeAuthedClient({
      userId: USER,
      from: (table: string) => {
        if (table === "job_preferences") return queryWithError("prefs unavailable");
        return queryWithData(null);
      },
    }) as unknown as CandidateClient;
    const rpc = vi.fn();
    (c as unknown as { rpc: unknown }).rpc = rpc;

    await expect(getCandidateDashboard(c, USER)).rejects.toThrow(/job preferences/);
    expect(rpc).not.toHaveBeenCalled();
  });
});

describe("the application agent section", () => {
  it("is null when the candidate has never opened the agent settings", async () => {
    // Returning a fabricated default settings row would claim configuration that
    // does not exist, including a daily limit nobody set.
    const { client: c } = client({ tables: { ...emptyTables, application_agent_settings: null } });
    expect((await getCandidateDashboard(c, USER)).agent).toBeNull();
  });

  it("reports the stored mode, limit and apply method", async () => {
    const { client: c } = client({
      tables: {
        ...emptyTables,
        application_agent_settings: {
          mode: "hybrid",
          paused: false,
          daily_application_limit: 5,
          minimum_match_score: 80,
          default_apply_method: "smart_apply",
        },
      },
    });
    const dash = await getCandidateDashboard(c, USER);
    expect(dash.agent).toEqual({
      mode: "hybrid",
      paused: false,
      status: "active",
      dailyApplicationLimit: 5,
      minimumMatchScore: 80,
      defaultApplyMethod: "smart_apply",
      decisionsToday: 0,
    });
  });

  it("falls back to the conservative defaults for values outside the stored domains", async () => {
    const { client: c } = client({
      tables: {
        ...emptyTables,
        application_agent_settings: {
          mode: "godmode",
          paused: false,
          daily_application_limit: null,
          minimum_match_score: null,
          default_apply_method: "apply_everything",
        },
      },
    });
    const dash = await getCandidateDashboard(c, USER);
    expect(dash.agent?.mode).toBe("review");
    expect(dash.agent?.defaultApplyMethod).toBe("apply");
    expect(dash.agent?.minimumMatchScore).toBe(85);
  });

  it("treats an unknown pause state as paused", async () => {
    // Assuming "running" would let a settings row with a missing column read as
    // permission to apply without anyone having given it.
    const { client: c } = client({
      tables: {
        ...emptyTables,
        application_agent_settings: { mode: "auto", paused: null },
      },
    });
    const dash = await getCandidateDashboard(c, USER);
    expect(dash.agent?.paused).toBe(true);
    expect(dash.agent?.status).toBe("paused");
  });
});

describe("the wallet section", () => {
  it("reports the balance and says whether an application is affordable", async () => {
    // "Has money" and "can apply" are different statements: a candidate with 48
    // cents has money and cannot start a $0.49 application.
    const { client: c } = client({
      tables: {
        ...emptyTables,
        credit_balances: {
          wallet_balance_cents: 500,
          interview_passes: 2,
          live_unlimited_until: "2027-01-01T00:00:00.000Z",
        },
      },
    });
    const dash = await getCandidateDashboard(c, USER);
    expect(dash.wallet.balanceCents).toBe(500);
    expect(dash.wallet.canApply).toBe(true);
    expect(dash.wallet.interviewPasses).toBe(2);
    expect(dash.wallet.liveUnlimitedUntil).toBe("2027-01-01T00:00:00.000Z");
  });

  it("does not claim affordability one cent short of a standard apply", async () => {
    const { client: c } = client({
      tables: { ...emptyTables, credit_balances: { wallet_balance_cents: 48 } },
    });
    expect((await getCandidateDashboard(c, USER)).wallet.canApply).toBe(false);
  });

  it("includes recent wallet movements with their sign", async () => {
    const { client: c } = client({
      tables: {
        ...emptyTables,
        credit_balances: { wallet_balance_cents: 1851 },
        credit_transactions: [
          {
            id: "c1",
            credit_type: "standard_apply",
            delta: -49,
            amount_cents: 49,
            reason: "standard apply charge",
            created_at: "2026-10-26T12:00:00.000Z",
          },
          {
            id: "c2",
            credit_type: "wallet_topup",
            delta: 1900,
            amount_cents: 1900,
            reason: "topup",
            created_at: "2026-10-25T12:00:00.000Z",
          },
        ],
      },
    });
    const dash = await getCandidateDashboard(c, USER);
    expect(dash.wallet.recent).toHaveLength(2);
    expect(dash.wallet.recent[0]).toMatchObject({ creditType: "standard_apply", delta: -49 });
    expect(dash.wallet.recent[1]).toMatchObject({ creditType: "wallet_topup", delta: 1900 });
  });

  it("keeps a charge negative and a refund positive", async () => {
    // A regression guard. A count reader that floors at zero -- which is correct
    // for a count, because a negative count is not a real state -- turns every
    // charge and every refund into 0. The feed would then show the candidate
    // paid nothing and was refunded nothing.
    const { client: c } = client({
      tables: {
        ...emptyTables,
        credit_transactions: [
          { id: "c1", credit_type: "smart_apply", delta: -199, reason: "charge", created_at: "2026-10-26T12:00:00.000Z" },
          { id: "c2", credit_type: "standard_apply", delta: 49, reason: "refund", created_at: "2026-10-25T12:00:00.000Z" },
        ],
      },
    });
    const [charge, refund] = (await getCandidateDashboard(c, USER)).wallet.recent;
    expect(charge?.delta).toBe(-199);
    expect(refund?.delta).toBe(49);
  });

  it("does not turn a negative count into a positive one", async () => {
    // The counterpart: a count can be malformed, and a negative one has no
    // meaning, so it collapses to zero rather than becoming a credit.
    const { client: c } = client({
      counts: [{ ...COUNTS, jobs_discovered: "-5", applications_total: "-1" }],
      tables: emptyTables,
    });
    const dash = await getCandidateDashboard(c, USER);
    expect(dash.counts.jobsDiscovered).toBe(0);
    expect(dash.counts.applicationsTotal).toBe(0);
  });
});

describe("the resume section", () => {
  it("reports not-ready when resumes exist but none is approved", async () => {
    // An uploaded but unapproved resume cannot be sent anywhere, so total > 0
    // alone would tell the candidate they are ready when they are not.
    const { client: c } = client({
      counts: [{ ...COUNTS, resumes_total: "2", resumes_approved: "0" }],
      tables: { ...emptyTables, resumes: { id: "r1", file_name: "cv.pdf" } },
    });
    const dash = await getCandidateDashboard(c, USER);
    expect(dash.resume.total).toBe(2);
    expect(dash.resume.approved).toBe(0);
    expect(dash.resume.ready).toBe(false);
    expect(dash.resume.primaryResumeId).toBe("r1");
  });

  it("reports ready only when an approved resume exists", async () => {
    const { client: c } = client({
      counts: [{ ...COUNTS, resumes_total: "2", resumes_approved: "1" }],
      tables: { ...emptyTables, resumes: { id: "r1", file_name: "cv.pdf" } },
    });
    const dash = await getCandidateDashboard(c, USER);
    expect(dash.resume.ready).toBe(true);
    expect(dash.resume.primaryFileName).toBe("cv.pdf");
  });
});

describe("the activity feed", () => {
  const events = [
    {
      id: "a1",
      event_type: "application_needs_review",
      title: "Ready to send to Acme. Review it first.",
      detail: null,
      entity_type: "application_run",
      entity_id: "run1",
      occurred_at: "2026-10-27T12:00:00.000Z",
    },
    {
      id: "a2",
      event_type: "application_submitted",
      title: "Applied to Acme",
      detail: "Engineer",
      entity_type: "application",
      entity_id: "app1",
      occurred_at: "2026-10-27T11:00:00.000Z",
    },
  ];

  it("projects the stored events with their links", async () => {
    const { client: c } = client({
      tables: { ...emptyTables, candidate_activity_events: events },
    });
    const dash = await getCandidateDashboard(c, USER);
    expect(dash.activity).toHaveLength(2);
    expect(dash.activity[0]).toMatchObject({
      eventType: "application_needs_review",
      href: "/applications/run1",
      needsAttention: true,
    });
    expect(dash.activity[1]?.needsAttention).toBe(false);
  });

  it("derives the attention list from the feed rather than a second query", async () => {
    // Two reads of the same fact can disagree. The attention items are a subset
    // of what the feed already returned.
    const { client: c } = client({
      tables: { ...emptyTables, candidate_activity_events: events },
    });
    const dash = await getCandidateDashboard(c, USER);
    expect(dash.needsAttention).toHaveLength(1);
    expect(dash.needsAttention[0]?.id).toBe("a1");
    expect(dash.activity.filter((i) => i.needsAttention)).toEqual(dash.needsAttention);
  });

  it("drops an event type outside the vocabulary rather than rendering a blank line", async () => {
    const { client: c } = client({
      tables: {
        ...emptyTables,
        candidate_activity_events: [
          ...events,
          {
            id: "a3",
            event_type: "email_detected",
            title: "Interview invitation",
            detail: null,
            entity_type: "application",
            entity_id: "app1",
            occurred_at: "2026-10-27T13:00:00.000Z",
          },
        ],
      },
    });
    const dash = await getCandidateDashboard(c, USER);
    expect(dash.activity.map((i) => i.id)).toEqual(["a1", "a2"]);
  });
});

describe("the strong match list", () => {
  const jobs = [
    {
      id: "j1",
      company_name: "Acme",
      role_title: "Engineer",
      location: "Remote",
      work_arrangement: "remote",
      employment_type: "full_time",
      salary_text: "$120k",
      description: null,
      match_score: 92,
      status: "discovered",
      source: "direct",
      source_url: null,
      discovered_at: "2026-10-01T00:00:00.000Z",
    },
    {
      id: "j2",
      company_name: "Beta",
      role_title: "Analyst",
      location: null,
      work_arrangement: null,
      employment_type: null,
      salary_text: null,
      description: null,
      match_score: 71,
      status: "discovered",
      source: "direct",
      source_url: null,
      discovered_at: "2026-10-02T00:00:00.000Z",
    },
  ];

  it("lists the top matches at or above the candidate's own threshold", async () => {
    const { client: c } = client({
      tables: {
        ...emptyTables,
        job_preferences: { min_match_score: 85 },
        job_opportunities: jobs,
      },
    });
    const dash = await getCandidateDashboard(c, USER);
    expect(dash.topStrongMatches.map((j) => j.id)).toEqual(["j1"]);
  });

  it("is a bounded display list, never a count source", async () => {
    // The list can be short -- or empty when the capped fetch found nothing above
    // the threshold -- while the count stays exact and RPC-driven. The two are
    // deliberately different shapes of the same truth.
    const { client: c } = client({
      tables: { ...emptyTables, job_opportunities: jobs },
    });
    const dash = await getCandidateDashboard(c, USER);
    expect(dash.counts.strongMatches).toBe(3); // fixture says 3
    expect(dash.topStrongMatches.map((j) => j.id)).toEqual(["j1"]);
  });
});

describe("the candidate identity section", () => {
  it("reads the name, headline and onboarding state from the profile", async () => {
    const { client: c } = client({
      tables: {
        ...emptyTables,
        profiles: {
          full_name: "Ada Lovelace",
          headline: "Algorithm engineer at an analytical engine firm",
          onboarding_completed: true,
        },
      },
    });
    const dash = await getCandidateDashboard(c, USER);
    expect(dash.candidate).toEqual({
      name: "Ada Lovelace",
      headline: "Algorithm engineer at an analytical engine firm",
      onboardingCompleted: true,
    });
  });

  it("does not treat a missing profile row as a completed onboarding", async () => {
    const { client: c } = client({ tables: emptyTables });
    const dash = await getCandidateDashboard(c, USER);
    expect(dash.candidate.name).toBeNull();
    expect(dash.candidate.onboardingCompleted).toBe(false);
  });
});

describe("the generated timestamp", () => {
  it("records when the answer was computed so a stale render can be identified", async () => {
    const { client: c } = client({ tables: emptyTables });
    const before = Date.now();
    const dash = await getCandidateDashboard(c, USER);
    expect(Date.parse(dash.generatedAt)).toBeGreaterThanOrEqual(before);
    expect(Date.parse(dash.generatedAt)).toBeLessThanOrEqual(Date.now());
  });
});

// --- local query doubles -----------------------------------------------------
// The shared fake returns `{data, error}`; these add the two shapes a test needs
// to assert on an error path and on a table the service has not configured.

function queryWithData(data: unknown) {
  const result = { data, error: null };
  const builder: Record<string, unknown> = {};
  for (const m of ["select", "eq", "neq", "in", "order", "limit", "or"]) {
    builder[m] = () => builder;
  }
  builder.maybeSingle = async () => result;
  builder.single = async () => result;
  builder.then = (r: (v: unknown) => unknown) => Promise.resolve(result).then(r);
  return builder;
}

function queryWithError(message: string) {
  const result = { data: null, error: { message } };
  const builder: Record<string, unknown> = {};
  for (const m of ["select", "eq", "neq", "in", "order", "limit", "or"]) {
    builder[m] = () => builder;
  }
  builder.maybeSingle = async () => result;
  builder.single = async () => result;
  builder.then = (r: (v: unknown) => unknown) => Promise.resolve(result).then(r);
  return builder;
}
