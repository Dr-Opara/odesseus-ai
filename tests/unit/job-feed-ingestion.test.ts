import { describe, expect, it, vi } from "vitest";
import { runPublicFeedIngestion } from "@/lib/jobs/feed-ingestion";
import type { JobSourceConfig, NormalizedJobPosting } from "@/lib/jobs/types";

function posting(overrides: Partial<NormalizedJobPosting> = {}): NormalizedJobPosting {
  return {
    provider: "greenhouse",
    sourceKey: "greenhouse:acme",
    companyName: "Acme",
    externalId: "job-1",
    title: "Engineer",
    location: "Remote",
    workArrangement: "remote",
    employmentType: "Full-time",
    salaryText: "$120k",
    description: "Build things with a sufficiently long description for realism.",
    sourceUrl: "https://boards.example/acme/job-1",
    applyUrl: "https://boards.example/acme/job-1/apply",
    publishedAt: "2026-01-01T00:00:00Z",
    updatedAt: null,
    ...overrides,
  };
}

const SOURCE: JobSourceConfig = { provider: "greenhouse", companyName: "Acme", slug: "acme" };

type Call = { table: string; op: string; args: unknown[] };

/** Minimal service fake recording upsert/update/select flows. */
function feedServiceFake(state: {
  publishedJobs?: unknown[];
  mirroredActive?: Array<{ id: string; external_id: string }>;
  staleUpdated?: unknown[];
} = {}) {
  const calls: Call[] = [];
  const from = (table: string) => {
    const builder: Record<string, unknown> = {};
    builder.select = () => builder;
    builder.eq = () => builder;
    builder.lt = () => builder;
    builder.in = () => builder;
    builder.order = () => builder;
    builder.upsert = (...args: unknown[]) => {
      calls.push({ table, op: "upsert", args });
      return Promise.resolve({ data: [], error: null });
    };
    builder.update = (...args: unknown[]) => {
      calls.push({ table, op: "update", args });
      const updated: Record<string, unknown> = {};
      updated.select = () => ({
        then: (resolve: (value: unknown) => unknown) =>
          Promise.resolve({ data: state.staleUpdated ?? [], error: null }).then(
            resolve as (value: unknown) => unknown
          ),
      });
      updated.eq = () => updated;
      updated.lt = () => updated;
      updated.in = () => updated;
      return updated;
    };
    builder.then = (resolve: (value: unknown) => unknown) => {
      if (table === "employer_jobs") {
        return Promise.resolve({ data: state.publishedJobs ?? [], error: null }).then(
          resolve as (value: unknown) => unknown
        );
      }
      if (table === "public_job_posts") {
        return Promise.resolve({ data: state.mirroredActive ?? [], error: null }).then(
          resolve as (value: unknown) => unknown
        );
      }
      return Promise.resolve({ data: [], error: null }).then(
        resolve as (value: unknown) => unknown
      );
    };
    return builder;
  };
  return { service: { from } as never, calls };
}

describe("public feed ingestion (2S)", () => {
  it("upserts provider postings keyed by source identity", async () => {
    const { service, calls } = feedServiceFake();
    const summary = await runPublicFeedIngestion({
      service,
      sources: [SOURCE],
      fetchJobs: async () => [posting(), posting({ externalId: "job-2", title: "Designer" })],
    });

    expect(summary.sourcesSucceeded).toBe(1);
    expect(summary.postingsUpserted).toBe(2);
    const upsert = calls.find((c) => c.table === "public_job_posts" && c.op === "upsert");
    expect(upsert).toBeDefined();
  });

  it("tolerates a failing source without failing the tick", async () => {
    const { service } = feedServiceFake();
    const summary = await runPublicFeedIngestion({
      service,
      sources: [SOURCE, { provider: "lever", companyName: "Beta", slug: "beta" }],
      fetchJobs: async (source) => {
        if (source.provider === "lever") throw new Error("provider down");
        return [posting()];
      },
    });

    expect(summary.sourcesSucceeded).toBe(1);
    expect(summary.sourcesFailed).toBe(1);
    expect(summary.errors).toHaveLength(1);
    expect(summary.postingsUpserted).toBe(1);
  });

  it("mirrors published employer jobs and deactivates unpublished ones", async () => {
    const { service, calls } = feedServiceFake({
      publishedJobs: [
        {
          id: "emp-1",
          title: "Engineer",
          description: "Build.",
          location: "Remote",
          requirements_text: null,
          preferred_text: null,
          work_arrangement: "remote",
          status: "published",
          posted_at: "2026-01-02T00:00:00Z",
          employer_organizations: { name: "Acme" },
        },
      ],
      mirroredActive: [
        { id: "row-1", external_id: "emp-1" },
        { id: "row-2", external_id: "emp-closed" },
      ],
    });

    const summary = await runPublicFeedIngestion({ service, sources: [] });

    expect(summary.employerMirrored).toBe(1);
    expect(summary.employerDeactivated).toBe(1);
    const mirrorUpsert = calls.find(
      (c) =>
        c.table === "public_job_posts" &&
        c.op === "upsert" &&
        JSON.stringify(c.args).includes("emp-1")
    );
    expect(mirrorUpsert).toBeDefined();
  });

  it("retires postings unseen past the staleness window", async () => {
    const { service, calls } = feedServiceFake({
      staleUpdated: [{ id: "old-1" }, { id: "old-2" }],
    });

    const summary = await runPublicFeedIngestion({
      service,
      sources: [],
      staleDays: 30,
      now: new Date("2026-03-01T00:00:00Z"),
    });

    expect(summary.deactivatedStale).toBe(2);
    const staleUpdate = calls.find(
      (c) => c.table === "public_job_posts" && c.op === "update"
    );
    expect(staleUpdate).toBeDefined();
  });

  it("survives an empty source catalog", async () => {
    const { service } = feedServiceFake();
    const summary = await runPublicFeedIngestion({ service, sources: [] });

    expect(summary.sourcesConfigured).toBe(0);
    expect(summary.postingsUpserted).toBe(0);
  });
});
