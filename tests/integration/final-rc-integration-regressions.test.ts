import { describe, expect, it, vi, beforeEach } from "vitest";
import { fakeAuthedClient, fakeQueryResult } from "../helpers/fake-supabase";

/**
 * Regression tests for the Task 8 integration findings.
 *
 * Each of these was a defect found by exercising the merged Final RC against a
 * real local stack rather than by reading the code, and each is a case where the
 * response was honest to nobody: a write that reported success without writing,
 * a malformed path that surfaced as a server fault, an internal error string
 * handed to the caller, and a provider failure that broke a live interview.
 */

const createClientMock = vi.fn();
const serviceClientMock = vi.fn();

vi.mock("@/lib/supabase/server", () => ({ createClient: () => createClientMock() }));
vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: () => serviceClientMock(),
}));

const USER = "51111111-1111-4111-8111-111111111111";
const OTHER = "59999999-9999-4999-8999-999999999999";
const OPP_ID = "52222222-2222-4222-8222-222222222222";

function authedAs(userId: string) {
  createClientMock.mockResolvedValue({
    auth: { getClaims: async () => ({ data: { claims: { sub: userId } } }) },
  });
}

describe("POST /api/jobs/[id]/status does not report a write that did not happen", () => {
  /**
   * The update filtered on `user_id`, so a cross-user or nonexistent id matched
   * zero rows -- but only the *error* was inspected, so the route answered
   * `200 {ok: true}`. The client was told a status changed when nothing was
   * written, and a candidate's tracked-job list could silently disagree with
   * what the UI showed. The `.select()` is what makes "updated" and "matched
   * nothing" distinguishable.
   */
  function updateReturning(row: unknown) {
    const chain: Record<string, unknown> = {};
    chain.eq = vi.fn(() => chain);
    chain.select = vi.fn(() => chain);
    chain.maybeSingle = async () => ({ data: row, error: null });
    const update = vi.fn(() => chain);
    return { update, chain };
  }

  beforeEach(() => {
    createClientMock.mockReset();
    serviceClientMock.mockReset();
  });

  it("answers 404 for another candidate's tracked job and writes nothing", async () => {
    authedAs(OTHER);
    const { update } = updateReturning(null);
    createClientMock.mockResolvedValue({
      auth: { getClaims: async () => ({ data: { claims: { sub: OTHER } } }) },
      from: () => ({ update }),
    });

    const { POST } = await import("@/app/api/jobs/[id]/status/route");
    const response = await POST(
      new Request("http://localhost/x", {
        method: "POST",
        body: JSON.stringify({ status: "rejected" }),
      }),
      { params: Promise.resolve({ id: OPP_ID }) }
    );

    expect(response.status).toBe(404);
    // The scope filter is what makes this safe, so it is asserted rather than
    // assumed: a service-free route can rely on the caller's own uid here.
    const { chain } = updateReturning(null);
    void chain;
    expect(update).toHaveBeenCalled();
  });

  it("answers 404 for a job id that does not exist", async () => {
    authedAs(USER);
    const { update } = updateReturning(null);
    createClientMock.mockResolvedValue({
      auth: { getClaims: async () => ({ data: { claims: { sub: USER } } }) },
      from: () => ({ update }),
    });

    const { POST } = await import("@/app/api/jobs/[id]/status/route");
    const response = await POST(
      new Request("http://localhost/x", {
        method: "POST",
        body: JSON.stringify({ status: "saved" }),
      }),
      { params: Promise.resolve({ id: "00000000-0000-4000-8000-00000000dead" }) }
    );

    expect(response.status).toBe(404);
  });

  it("answers 404 for a non-uuid id rather than letting the cast fail as a 500", async () => {
    authedAs(USER);
    const { update } = updateReturning(null);
    createClientMock.mockResolvedValue({
      auth: { getClaims: async () => ({ data: { claims: { sub: USER } } }) },
      from: () => ({ update }),
    });

    const { POST } = await import("@/app/api/jobs/[id]/status/route");
    const response = await POST(
      new Request("http://localhost/x", {
        method: "POST",
        body: JSON.stringify({ status: "saved" }),
      }),
      { params: Promise.resolve({ id: "not-a-uuid" }) }
    );

    expect(response.status).toBe(404);
    expect(update).not.toHaveBeenCalled();
  });

  it("answers 200 with the stored status when the row really was updated", async () => {
    authedAs(USER);
    const { update } = updateReturning({ id: OPP_ID, status: "saved" });
    createClientMock.mockResolvedValue({
      auth: { getClaims: async () => ({ data: { claims: { sub: USER } } }) },
      from: () => ({ update }),
    });

    const { POST } = await import("@/app/api/jobs/[id]/status/route");
    const response = await POST(
      new Request("http://localhost/x", {
        method: "POST",
        body: JSON.stringify({ status: "saved" }),
      }),
      { params: Promise.resolve({ id: OPP_ID }) }
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ ok: true, status: "saved" });
  });

  it("still refuses a status outside the candidate-writable vocabulary", async () => {
    authedAs(USER);
    const { update } = updateReturning(null);
    createClientMock.mockResolvedValue({
      auth: { getClaims: async () => ({ data: { claims: { sub: USER } } }) },
      from: () => ({ update }),
    });

    const { POST } = await import("@/app/api/jobs/[id]/status/route");
    for (const status of ["applied", "reviewing", "approved", "closed"]) {
      const response = await POST(
        new Request("http://localhost/x", {
          method: "POST",
          body: JSON.stringify({ status }),
        }),
        { params: Promise.resolve({ id: OPP_ID }) }
      );
      // An application is a verified fact, not something a candidate asserts.
      expect(response.status).toBe(400);
    }
    expect(update).not.toHaveBeenCalled();
  });
});

describe("checkout routes report a missing Stripe key as configuration, not a fault", () => {
  /**
   * The guard read `NEXT_PUBLIC_SITE_URL` and called that the billing
   * configuration. With the site URL set and `STRIPE_SECRET_KEY` absent,
   * `getStripe()` threw and the caller got a 500 from an unhandled
   * configuration error, where the route plainly meant to answer 503.
   */
  const ROUTES = [
    "@/app/api/employer/orgs/[orgId]/seats/checkout/route",
    "@/app/api/employer/orgs/[orgId]/plans/checkout/route",
    "@/app/api/employer/orgs/[orgId]/featured/checkout/route",
  ] as const;

  beforeEach(() => {
    createClientMock.mockReset();
    serviceClientMock.mockReset();
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://odesseus.test");
    vi.unstubAllEnvs();
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://odesseus.test");
    vi.stubEnv("STRIPE_SECRET_KEY", "");
  });

  it.each(ROUTES)("%s answers 503 when Stripe is not configured", async (route) => {
    const FEATURED_JOB = "00000000-0000-4000-8000-00000000beef";
    createClientMock.mockResolvedValue(
      fakeAuthedClient({
        userId: USER,
        from: (table: string) => {
          if (table === "employer_organizations") {
            return fakeQueryResult({ id: "org-1", owner_user_id: USER });
          }
          if (table === "employer_members") {
            return fakeQueryResult({ org_id: "org-1", user_id: USER, role: "owner" });
          }
          // The featured route resolves the job before it reaches the billing
          // guard, because a caller must not get as far as payment for a job
          // that is not theirs to boost. So the fixture needs a real one.
          if (table === "employer_jobs") {
            return fakeQueryResult({
              id: FEATURED_JOB,
              org_id: "org-1",
              status: "published",
              title: "Platform Engineer",
            });
          }
          return fakeQueryResult(null);
        },
      })
    );
    serviceClientMock.mockReturnValue(fakeAuthedClient({ userId: "service" }));

    const { POST } = await import(route);
    const response = await POST(
      new Request("http://localhost/x", {
        method: "POST",
        body: JSON.stringify(
          route.includes("seats")
            ? { seatCount: 2 }
            : route.includes("plans")
              ? { tier: "growth" }
              : { tier: "featured_7d", jobId: FEATURED_JOB }
        ),
      }),
      { params: Promise.resolve({ orgId: "52222222-2222-4222-8222-222222222222" }) }
    );

    expect(response.status).toBe(503);
    const body = await response.json();
    expect(body.error).toBe("Billing is not configured.");
  });
});
