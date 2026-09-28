import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

const MIGRATION = "supabase/migrations/20261026000000_employer_application_attribution.sql";

const read = (relative: string) =>
  readFileSync(path.join(repoRoot, relative), "utf8").replace(/\r\n/g, "\n");

const sql = read(MIGRATION);

/** Body of get_employer_metrics, from its declaration to the end of its body.
 *  Everything asserted about the join must live inside this slice, not in the
 *  file header, or the assertion could be satisfied by the prose. */
function functionBody(declaration: string): string {
  const start = sql.indexOf(declaration);
  expect(start).toBeGreaterThanOrEqual(0);
  const end = sql.indexOf("\n$function$;", start);
  expect(end).toBeGreaterThan(start);
  return sql.slice(start, end);
}

const employerMetrics = functionBody(
  "CREATE OR REPLACE FUNCTION public.get_employer_metrics"
);
const candidateMetrics = functionBody(
  "CREATE OR REPLACE FUNCTION public.get_candidate_metrics"
);
const applicantCounts = functionBody(
  "CREATE OR REPLACE FUNCTION public.odesseus_get_employer_applicant_counts"
);

describe("employer application attribution migration", () => {
  it("is additive: it rewrites no historical migration and no historical row", () => {
    expect(sql).not.toMatch(/^DROP TABLE/im);
    expect(sql).not.toMatch(/^DROP COLUMN/im);
    expect(sql).not.toMatch(/^DELETE FROM/im);
    expect(sql).not.toMatch(/^UPDATE public\./im);
    // No backfill. Guessing which employer owned which historical job is
    // invented attribution, which is the thing this database must not do.
    expect(sql).not.toMatch(/^UPDATE public\.job_opportunities/im);
  });

  it("adds the one missing edge of the path, nullable and non-destructive", () => {
    expect(sql).toMatch(
      /ALTER TABLE public\.job_opportunities\s*\n?\s*ADD COLUMN IF NOT EXISTS employer_job_id uuid REFERENCES public\.employer_jobs\(id\) ON DELETE SET NULL;/
    );
    // ON DELETE SET NULL, not CASCADE: deleting a posting must not delete a
    // candidate's job history.
    expect(sql).not.toMatch(/employer_job_id uuid REFERENCES public\.employer_jobs\(id\) ON DELETE CASCADE/);
  });

  it("documents why the column exists and why historical rows are null", () => {
    expect(sql).toMatch(
      /COMMENT ON COLUMN public\.job_opportunities\.employer_job_id IS/
    );
    expect(sql).toMatch(/not backfilled/i);
  });

  it("partially indexes only the attributed rows", () => {
    expect(sql).toMatch(
      /CREATE INDEX IF NOT EXISTS job_opportunities_employer_job_id_idx\s*\n\s*ON public\.job_opportunities \(employer_job_id\)\s*\n\s*WHERE employer_job_id IS NOT NULL;/
    );
  });
});

describe("get_employer_metrics", () => {
  it("joins through job_opportunities, never directly to employer_jobs", () => {
    expect(employerMetrics).toMatch(
      /JOIN public\.job_opportunities jo ON jo\.id = a\.job_id\s*\n\s*JOIN public\.employer_jobs ej ON ej\.id = jo\.employer_job_id/
    );
  });

  it("no longer contains the dead join", () => {
    // The exact defect: applications.job_id is a foreign key to
    // job_opportunities(id), so comparing it to an employer_jobs primary key
    // compares two unrelated id spaces.
    expect(employerMetrics).not.toMatch(/employer_jobs ej ON ej\.id = a\.job_id/);
    expect(employerMetrics).not.toMatch(/JOIN public\.employer_jobs ej ON ej\.id = a\./);
  });

  it("counts only applications attributable to an employer posting", () => {
    expect(employerMetrics).toMatch(/AND jo\.employer_job_id IS NOT NULL/);
  });

  it("keeps the same eight-column shape so existing callers still work", () => {
    for (const column of [
      "employer_registrations",
      "paid_plan_conversion",
      "jobs_posted",
      "active_jobs",
      "applicants_per_job",
      "featured_job_usage",
      "recruiter_seats",
      "applicant_review_activity",
    ]) {
      expect(employerMetrics).toContain(column);
    }
  });

  it("is redefined, not duplicated", () => {
    expect(sql.match(/CREATE OR REPLACE FUNCTION public\.get_employer_metrics/g)).toHaveLength(1);
  });

  it("stays server-side only", () => {
    expect(sql).toMatch(
      /REVOKE ALL ON FUNCTION public\.get_employer_metrics\(timestamptz, timestamptz\) FROM PUBLIC;/
    );
    expect(sql).toMatch(
      /REVOKE ALL ON FUNCTION public\.get_employer_metrics\(timestamptz, timestamptz\) FROM anon;/
    );
    expect(sql).toMatch(
      /REVOKE ALL ON FUNCTION public\.get_employer_metrics\(timestamptz, timestamptz\) FROM authenticated;/
    );
    expect(sql).toMatch(
      /GRANT EXECUTE ON FUNCTION public\.get_employer_metrics\(timestamptz, timestamptz\) TO postgres, service_role;/
    );
  });
});

describe("get_candidate_metrics had the same defect one function over", () => {
  it("joins applications to runs on applications.run_id", () => {
    expect(candidateMetrics).toMatch(
      /JOIN public\.application_runs ar ON ar\.id = a\.run_id/
    );
  });

  it("no longer joins two different tables' primary keys", () => {
    // applications.id and application_runs.id are unrelated, so this matched
    // nothing and successful_application_rate was always 0.
    expect(candidateMetrics).not.toMatch(/ar\.id = a\.id/);
  });

  it("keeps the same eight-column shape", () => {
    for (const column of [
      "signup_count",
      "onboarding_completion",
      "wallet_funding_conversion",
      "standard_apply_usage",
      "smart_apply_usage",
      "successful_application_rate",
      "interview_progression",
      "live_usage",
    ]) {
      expect(candidateMetrics).toContain(column);
    }
  });
});

describe("odesseus_get_employer_applicant_counts", () => {
  it("is a new, differently-scoped accessor, not a duplicate of the global one", () => {
    // get_employer_metrics has no org parameter, so it cannot answer "how many
    // applicants does this organization have" and cannot be used to prove that
    // one organization's applicants stay out of another's.
    expect(sql).toMatch(
      /CREATE OR REPLACE FUNCTION public\.odesseus_get_employer_applicant_counts \(\s*p_org_id uuid/
    );
  });

  it("scopes by the org argument and reaches applications only through the new edge", () => {
    expect(applicantCounts).toMatch(/WHERE ej\.org_id = p_org_id/);
    expect(applicantCounts).toMatch(/LEFT JOIN public\.job_opportunities jo\s*\n\s*ON jo\.employer_job_id = ej\.id/);
    expect(applicantCounts).toMatch(/LEFT JOIN public\.applications a\s*\n\s*ON a\.job_id = jo\.id/);
    // No second path from an application to an employer that could bypass the
    // foreign key.
    expect(applicantCounts).not.toMatch(/a\.job_id = ej\.id/);
  });

  it("keeps postings with no applicants in the result", () => {
    // LEFT JOIN, not INNER: a posting nobody applied to is 0 applicants, and it
    // must not silently disappear from an employer's own list.
    expect(applicantCounts).toMatch(/LEFT JOIN public\.job_opportunities/);
    expect(applicantCounts).toMatch(/LEFT JOIN public\.applications/);
  });

  it("honours an optional window", () => {
    expect(applicantCounts).toMatch(/p_from IS NULL OR a\.created_at >= p_from/);
    expect(applicantCounts).toMatch(/p_to\s+IS NULL OR a\.created_at <\s+p_to/);
  });

  it("returns counts and ids only, never candidate profile data", () => {
    for (const column of [
      "employer_job_id",
      "job_opportunity_id",
      "job_title",
      "job_status",
      "applicant_count",
    ]) {
      expect(applicantCounts).toContain(column);
    }
    for (const forbidden of ["candidate", "user_id", "email", "full_name", "resume"]) {
      expect(applicantCounts).not.toMatch(new RegExp(`\\b${forbidden}\\b`, "i"));
    }
  });

  it("is SECURITY DEFINER with a pinned search_path, server-side only", () => {
    expect(applicantCounts).toMatch(/SECURITY DEFINER/);
    expect(applicantCounts).toMatch(
      /SET search_path TO 'public', 'odesseus_private', 'pg_temp'/
    );
    for (const role of ["PUBLIC", "anon", "authenticated"]) {
      expect(sql).toMatch(
        new RegExp(
          `REVOKE ALL ON FUNCTION public\\.odesseus_get_employer_applicant_counts\\(uuid, timestamptz, timestamptz\\) FROM ${role};`
        )
      );
    }
    expect(sql).toMatch(
      /GRANT EXECUTE ON FUNCTION public\.odesseus_get_employer_applicant_counts\(uuid, timestamptz, timestamptz\) TO postgres, service_role;/
    );
  });
});

describe("generated types", () => {
  const databaseTypes = read("src/types/database.ts");

  it("types job_opportunities.employer_job_id on Row, Insert and Update", () => {
    const table = databaseTypes.slice(
      databaseTypes.indexOf("job_opportunities: {"),
      databaseTypes.indexOf("live_interview_sessions: {")
    );
    expect(table).toMatch(/employer_job_id: string \| null;/);
    expect(table).toMatch(/employer_job_id\?: string \| null;/);
  });

  it("declares the new employer_job_id foreign key relationship", () => {
    expect(databaseTypes).toMatch(
      /foreignKeyName: "job_opportunities_employer_job_id_fkey";\s*\n\s*columns: \["employer_job_id"\];\s*\n\s*isOneToOne: false;\s*\n\s*referencedRelation: "employer_jobs";\s*\n\s*referencedColumns: \["id"\];/
    );
  });

  it("declares the per-organization applicant count RPC", () => {
    expect(databaseTypes).toMatch(
      /odesseus_get_employer_applicant_counts: \{\s*\n\s*Args: \{ p_org_id: string; p_from\?: string \| null; p_to\?: string \| null \};\s*\n\s*Returns: \{\s*\n\s*applicant_count: number;\s*\n\s*employer_job_id: string;\s*\n\s*job_opportunity_id: string \| null;\s*\n\s*job_status: string;\s*\n\s*job_title: string;\s*\n\s*\}\[\];/
    );
  });
});

describe("rls audit inventory is unchanged", () => {
  it("no public table was added, so the pinned count must still be 68", () => {
    const rlsAudit = read("supabase/tests/rls-audit.test.sql");
    expect(rlsAudit).toMatch(/56 \+ 9 \+ 1 \+ 2, 'public schema holds exactly 68 tables/);
  });
});
