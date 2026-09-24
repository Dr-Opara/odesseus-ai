import { describe, expect, it } from "vitest";
import {
  getApplications,
  getCandidateProfile,
  getCandidateUserId,
  getCreditBalance,
  getDocuments,
  getJobMatchWithBreakdown,
  getJobPreferences,
  getRecommendedJobs,
  getRecentActivity,
  getResumeTailoring,
  getSavedJobs,
  getUpcomingInterviews,
} from "@/lib/candidate/service";

type Row = Record<string, unknown>;

/**
 * A filter-aware fake Supabase client for the candidate service layer. It
 * applies the real `.eq()/.neq()/.not(in)/.in()` filters to per-table rows
 * and resolves like the real postgrest-js thenable, so service reads behave
 * the same as with the pricing service tests.
 */
function candidateFake(routes: Record<string, Row[]>, userId: string | null = "user-1") {
  const from = (table: string) => {
    const rows = (routes[table] ?? []) as Row[];
    const filters: Array<(row: Row) => boolean> = [];
    const builder: Record<string, unknown> = {};

    const matches = () => rows.filter((row) => filters.every((filter) => filter(row)));

    builder.select = () => builder;
    builder.eq = (column: string, value: unknown) => {
      filters.push((row) => row[column] === value);
      return builder;
    };
    builder.neq = (column: string, value: unknown) => {
      filters.push((row) => row[column] !== value);
      return builder;
    };
    builder.not = (column: string, operator: string, value: unknown) => {
      if (operator === "in") {
        const values = String(value).replace(/[()]/g, "").split(",");
        filters.push((row) => !values.includes(String(row[column])));
      }
      return builder;
    };
    builder.in = (column: string, values: unknown[]) => {
      filters.push((row) => values.includes(row[column]));
      return builder;
    };
    builder.order = () => builder;
    builder.limit = () => builder;
    builder.maybeSingle = async () => {
      const [first] = matches();
      return { data: first ?? null, error: null };
    };
    builder.then = (
      resolve: (value: { data: Row[]; error: null }) => unknown,
      reject?: (reason: unknown) => unknown
    ) => Promise.resolve({ data: matches(), error: null }).then(resolve, reject);
    return builder;
  };

  return {
    auth: {
      getClaims: async () => ({
        data: userId ? { claims: { sub: userId } } : { claims: null },
      }),
    },
    from,
  };
}

describe("candidate service layer (Phase 5 shared reads)", () => {
  it("resolves the signed-in user id from auth claims", async () => {
    await expect(getCandidateUserId(candidateFake({}) as never)).resolves.toBe("user-1");
  });

  it("returns null when there is no signed-in user", async () => {
    const client = candidateFake({}, null);
    await expect(getCandidateUserId(client as never)).resolves.toBeNull();
  });

  it("returns the candidate profile row or null", async () => {
    const client = candidateFake({
      profiles: [{ id: "user-1", full_name: "Ada Lovelace", headline: "Engineer", onboarding_completed: true }],
    });
    await expect(getCandidateProfile(client as never, "user-1")).resolves.toMatchObject({
      full_name: "Ada Lovelace",
    });

    await expect(getCandidateProfile(candidateFake({}) as never, "user-1")).resolves.toBeNull();
  });

  it("defaults a missing credit balance to zeros", async () => {
    await expect(getCreditBalance(candidateFake({}) as never, "user-1")).resolves.toEqual({
      application_credits: 0,
      interview_passes: 0,
      live_unlimited_until: null,
      wallet_balance_cents: 0,
    });
  });

  it("lists discovered jobs with match metadata and drops rejected/closed rows", async () => {
    const client = candidateFake({
      job_opportunities: [
        { id: "a", user_id: "user-1", company_name: "Acme", role_title: "Dev", match_score: 91, status: "discovered" },
        { id: "rej", user_id: "user-1", company_name: "Delta", role_title: "Ops", match_score: 88, status: "rejected" },
        { id: "closed", user_id: "user-1", company_name: "Gamma", role_title: "QA", match_score: 80, status: "closed" },
      ],
    });
    const result = await getRecommendedJobs(client as never, "user-1");
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ company_name: "Acme" });
  });

  it("returns only saved jobs from saved status records", async () => {
    const client = candidateFake({
      job_opportunities: [
        { id: "j1", user_id: "user-1", status: "saved" },
        { id: "j2", user_id: "user-1", status: "discovered" },
      ],
    });
    await expect(getSavedJobs(client as never, "user-1")).resolves.toEqual([
      { id: "j1", user_id: "user-1", status: "saved" },
    ]);
  });

  it("returns a job match with its stored match breakdown, or null", async () => {
    const row = {
      id: "j1",
      user_id: "user-1",
      role_title: "Dev",
      match_breakdown: { conciseSummary: "ok" },
    };
    const client = candidateFake({ job_opportunities: [row] });
    await expect(getJobMatchWithBreakdown(client as never, "user-1", "j1")).resolves.toEqual({
      job: row,
      match_breakdown: { conciseSummary: "ok" },
    });

    await expect(getJobMatchWithBreakdown(candidateFake({}) as never, "user-1", "nope")).resolves.toBeNull();
  });

  it("merges and sorts recent activity newest first", async () => {
    const client = candidateFake({
      application_status_events: [
        { id: 1, user_id: "user-1", title: "Application submitted", detail: "to Acme", occurred_at: "2026-01-01T10:00:00Z" },
      ],
      external_signals: [
        { id: "s1", user_id: "user-1", title: null, signal_type: "interview_invitation", occurred_at: null, created_at: "2026-01-02T10:00:00Z" },
      ],
    });
    const activity = await getRecentActivity(client as never, "user-1", 6);
    expect(activity[0]).toMatchObject({ key: "signal-s1", title: "Interview Invitation" });
    expect(activity[1]).toMatchObject({ key: "event-1", title: "Application submitted" });
  });

  it("lists applications most recently active first", async () => {
    const client = candidateFake({
      applications: [
        { id: "app-1", user_id: "user-1", company_name: "Acme", role_title: "Dev", status: "applied", last_event_at: "2026-01-10T00:00:00Z" },
      ],
    });
    await expect(getApplications(client as never, "user-1")).resolves.toMatchObject([
      { company_name: "Acme" },
    ]);
  });

  it("flattens interview rows with the related application context", async () => {
    const client = candidateFake({
      interviews: [
        {
          id: "i1",
          user_id: "user-1",
          status: "scheduled",
          scheduled_at: "2026-02-01T09:00:00Z",
          applications: { company_name: "Acme", role_title: "Dev" },
        },
      ],
    });
    const result = await getUpcomingInterviews(client as never, "user-1");
    expect(result[0]).toMatchObject({ role_title: "Dev", company_name: "Acme" });
  });

  it("loads job preferences and documents", async () => {
    const client = candidateFake({
      job_preferences: [{ user_id: "user-1", min_match_score: 90 }],
      resumes: [{ id: "r1", user_id: "user-1", file_name: "resume.pdf", is_master: true }],
    });
    await expect(getJobPreferences(client as never, "user-1")).resolves.toMatchObject({
      min_match_score: 90,
    });
    await expect(getDocuments(client as never, "user-1")).resolves.toEqual([
      { id: "r1", user_id: "user-1", file_name: "resume.pdf", is_master: true },
    ]);
  });

  it("returns a tailor run with its job and source resume, or null", async () => {
    const row = {
      id: "t1",
      user_id: "user-1",
      job_id: "j1",
      version_number: 2,
      status: "draft",
      improvement_count: 3,
      changes: [{ type: "rewrite", section: "summary" }],
      tailored_resume: { headline: "Great" },
      job_opportunities: { company_name: "Acme", role_title: "Dev", match_score: 92 },
      resumes: { parsed_data: { summary: "old" } },
    };
    const client = candidateFake({ resume_tailorings: [row] });
    const result = await getResumeTailoring(client as never, "user-1", "t1");
    expect(result).toMatchObject({
      id: "t1",
      jobId: "j1",
      versionNumber: 2,
      status: "draft",
      improvementCount: 3,
      job: { company_name: "Acme" },
      changes: [{ type: "rewrite" }],
      tailored: { headline: "Great" },
      sourceParsed: { summary: "old" },
    });

    await expect(getResumeTailoring(candidateFake({}) as never, "user-1", "nope")).resolves.toBeNull();
  });

  it("normalizes an absent changes array to an empty list on a tailor run", async () => {
    const client = candidateFake({
      resume_tailorings: [
        { id: "t1", user_id: "user-1", job_id: "j1", changes: null, tailored_resume: {} },
      ],
    });
    const result = await getResumeTailoring(client as never, "user-1", "t1");
    expect(result?.changes).toEqual([]);
  });

  it("throws a readable message when the DB reports an error", async () => {
    const broken = {
      auth: { getClaims: async () => ({ data: { claims: { sub: "user-1" } } }) },
      from: () => ({
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({ data: null, error: { message: "db unavailable" } }),
          }),
        }),
      }),
    };
    await expect(getCandidateProfile(broken as never, "user-1")).rejects.toThrow(
      "Could not load profile"
    );
  });
});