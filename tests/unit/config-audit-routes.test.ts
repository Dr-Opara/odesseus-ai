import { describe, expect, it, beforeEach, afterEach } from "vitest";

describe("temporary config-audit routes are disabled in production", () => {
  const originalVercelEnv = process.env.VERCEL_ENV;

  beforeEach(() => {
    delete process.env.VERCEL_ENV;
  });

  afterEach(() => {
    if (originalVercelEnv === undefined) delete process.env.VERCEL_ENV;
    else process.env.VERCEL_ENV = originalVercelEnv;
  });

  it("/api/health/config returns 404 when VERCEL_ENV is production", async () => {
    process.env.VERCEL_ENV = "production";
    const { GET } = await import("@/app/api/health/config/route");
    const response = await GET();
    expect(response.status).toBe(404);
  });

  it("/api/health/config returns config info outside production", async () => {
    process.env.VERCEL_ENV = "preview";
    const { GET } = await import("@/app/api/health/config/route");
    const response = await GET();
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toHaveProperty("configured");
    expect(body).toHaveProperty("missing");
  });

  it("/auth/config-check returns 404 when VERCEL_ENV is production", async () => {
    process.env.VERCEL_ENV = "production";
    const { GET } = await import("@/app/auth/config-check/route");
    const response = await GET();
    expect(response.status).toBe(404);
  });

  it("/auth/config-check returns config info outside production", async () => {
    process.env.VERCEL_ENV = "preview";
    const { GET } = await import("@/app/auth/config-check/route");
    const response = await GET();
    expect(response.status).toBe(200);
  });
});
