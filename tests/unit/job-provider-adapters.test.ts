import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchRecruiteeJobs } from "@/lib/jobs/providers/recruitee";
import { fetchSmartRecruitersJobs } from "@/lib/jobs/providers/smartrecruiters";
import { configuredJobSources } from "@/lib/jobs/sources";
import { fetchWorkdayJobs } from "@/lib/jobs/providers/workday";

const originalSources = process.env.ODYSSEUS_JOB_SOURCES_JSON;
const originalSr = process.env.SMARTRECRUITERS_TOKEN;
const originalRecruitee = process.env.RECRUITEE_CAREERS_TOKEN;

afterEach(() => {
  if (originalSources === undefined) delete process.env.ODYSSEUS_JOB_SOURCES_JSON;
  else process.env.ODYSSEUS_JOB_SOURCES_JSON = originalSources;

  if (originalSr === undefined) delete process.env.SMARTRECRUITERS_TOKEN;
  else process.env.SMARTRECRUITERS_TOKEN = originalSr;

  if (originalRecruitee === undefined) delete process.env.RECRUITEE_CAREERS_TOKEN;
  else process.env.RECRUITEE_CAREERS_TOKEN = originalRecruitee;

  vi.unstubAllGlobals();
});

describe("expanded job source catalog", () => {
  it("parses SmartRecruiters and Recruitee sources with server-side token references", () => {
    process.env.ODYSSEUS_JOB_SOURCES_JSON = JSON.stringify([
      {
        provider: "smartrecruiters",
        companyName: "Example SR",
        slug: "example",
        tokenEnv: "SMARTRECRUITERS_TOKEN",
      },
      {
        provider: "recruitee",
        companyName: "Example Recruitee",
        slug: "example",
        tokenEnv: "RECRUITEE_CAREERS_TOKEN",
      },
    ]);

    expect(configuredJobSources()).toHaveLength(2);
  });

  it("rejects unsafe token environment names", () => {
    process.env.ODYSSEUS_JOB_SOURCES_JSON = JSON.stringify([
      {
        provider: "recruitee",
        companyName: "Example",
        slug: "example",
        tokenEnv: "bad-token-name",
      },
    ]);

    expect(configuredJobSources()).toEqual([]);
  });
});

describe("SmartRecruiters provider", () => {
  it("normalizes public posting details", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ content: [{ id: "job-1" }], totalFound: 1 }),
          { status: 200 }
        )
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            id: "job-1",
            name: "Senior Security Engineer",
            postingUrl: "https://jobs.example.com/job-1",
            applyUrl: "https://jobs.example.com/job-1/apply",
            releasedDate: "2026-09-19T00:00:00Z",
            location: { city: "Houston", region: "TX", country: "US", remote: true },
            typeOfEmployment: { label: "Full-time" },
            compensation: {
              minSalary: 150000,
              maxSalary: 180000,
              currency: "USD",
              period: "year",
            },
            jobAd: {
              sections: {
                companyDescription: {
                  text: "<p>Join a growing security organization building resilient systems.</p>",
                },
                jobDescription: {
                  text: "<p>Lead cloud security architecture, incident prevention, detection engineering, governance, and secure platform delivery across enterprise services.</p>",
                },
              },
            },
          }),
          { status: 200 }
        )
      );

    vi.stubGlobal("fetch", fetchMock);

    const jobs = await fetchSmartRecruitersJobs({
      provider: "smartrecruiters",
      companyName: "Example",
      slug: "example",
    });

    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({
      provider: "smartrecruiters",
      title: "Senior Security Engineer",
      workArrangement: "remote",
      employmentType: "Full-time",
      applyUrl: "https://jobs.example.com/job-1/apply",
    });
  });
});

describe("Recruitee provider", () => {
  it("normalizes published careers-site offers", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          offers: [
            {
              id: 42,
              slug: "security-architect",
              title: "Security Architect",
              status: "published",
              kind: "job",
              careers_url: "https://example.recruitee.com/o/security-architect",
              remote: false,
              remote_option: "hybrid",
              employment_type: "Full-time",
              location: "Austin, TX",
              description:
                "<p>Design enterprise security architecture and work across engineering, governance, cloud, identity, and compliance teams.</p>",
              requirements:
                "<p>Experience with cloud security, IAM, security architecture, and regulated environments is required.</p>",
              published_at: "2026-09-18T00:00:00Z",
            },
          ],
        }),
        { status: 200 }
      )
    );

    vi.stubGlobal("fetch", fetchMock);

    const jobs = await fetchRecruiteeJobs({
      provider: "recruitee",
      companyName: "Example",
      slug: "example",
    });

    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({
      provider: "recruitee",
      title: "Security Architect",
      workArrangement: "hybrid",
      sourceUrl: "https://example.recruitee.com/o/security-architect",
    });
  });
});


describe("Workday provider", () => {
  it("normalizes public CXS listings and details", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            total: 1,
            jobPostings: [
              {
                title: "Principal Cloud Security Engineer",
                externalPath: "/job/Texas/Principal-Cloud-Security-Engineer_R-12345",
                locationsText: "US, Texas",
                postedOn: "Posted Today",
              },
            ],
          }),
          { status: 200 }
        )
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            jobPostingInfo: {
              jobReqId: "R-12345",
              location: "Houston, TX",
              timeType: "Full time",
              jobDescription:
                "<p>Lead cloud security architecture, identity, threat detection, secure engineering, governance, compliance, and enterprise platform security across critical services.</p>",
            },
          }),
          { status: 200 }
        )
      );

    vi.stubGlobal("fetch", fetchMock);

    const jobs = await fetchWorkdayJobs({
      provider: "workday",
      companyName: "Example Enterprise",
      slug: "example-workday",
      careerUrl: "https://example.wd5.myworkdayjobs.com/en-US/External",
      maxJobs: 20,
    });

    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({
      provider: "workday",
      externalId: "R-12345",
      title: "Principal Cloud Security Engineer",
      location: "Houston, TX",
      employmentType: "Full time",
    });

    expect(fetchMock.mock.calls[0][0]).toBe(
      "https://example.wd5.myworkdayjobs.com/wday/cxs/example/External/jobs"
    );
    expect(fetchMock.mock.calls[1][0]).toBe(
      "https://example.wd5.myworkdayjobs.com/wday/cxs/example/External/job/Texas/Principal-Cloud-Security-Engineer_R-12345"
    );
  });

  it("requires a real Workday careers URL", async () => {
    await expect(
      fetchWorkdayJobs({
        provider: "workday",
        companyName: "Example",
        slug: "example",
      })
    ).rejects.toThrow("Workday sources require careerUrl.");
  });
});
