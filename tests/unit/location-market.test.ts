import { describe, expect, it } from "vitest";
import {
  marketForCountry,
  resolveExplicitLocation,
  locationMatchesTerms,
} from "@/lib/jobs/location-market";

describe("job location matching", () => {
  it("maps Texas to Texas and TX-formatted locations", () => {
    const texas = resolveExplicitLocation("Texas");
    expect(texas?.terms).toContain("Texas");
    expect(texas?.terms).toContain(", TX");
    expect(locationMatchesTerms("Austin, TX", texas?.terms ?? [])).toBe(true);
    expect(locationMatchesTerms("London", texas?.terms ?? [])).toBe(false);
  });

  it("keeps city searches city-specific", () => {
    expect(locationMatchesTerms("London", resolveExplicitLocation("London")?.terms ?? [])).toBe(true);
    expect(locationMatchesTerms("Manchester", resolveExplicitLocation("London")?.terms ?? [])).toBe(false);
    expect(locationMatchesTerms("Lagos, Nigeria", resolveExplicitLocation("Lagos")?.terms ?? [])).toBe(true);
    expect(locationMatchesTerms("Abuja, Nigeria", resolveExplicitLocation("Lagos")?.terms ?? [])).toBe(false);
  });

  it("understands Washington DC aliases", () => {
    const dc = resolveExplicitLocation("DC");
    expect(locationMatchesTerms("Washington, DC", dc?.terms ?? [])).toBe(true);
  });

  it("uses country-wide matching for automatic visitor markets", () => {
    const nigeria = marketForCountry("NG");
    expect(locationMatchesTerms("Lagos, Nigeria", nigeria?.terms ?? [])).toBe(true);
    expect(locationMatchesTerms("Abuja, Nigeria", nigeria?.terms ?? [])).toBe(true);

    const us = marketForCountry("US");
    expect(locationMatchesTerms("Austin, TX", us?.terms ?? [])).toBe(true);
    expect(locationMatchesTerms("San Francisco, CA", us?.terms ?? [])).toBe(true);
  });
});
