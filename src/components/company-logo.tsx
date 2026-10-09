"use client";

import { useState } from "react";

const COMPANY_DOMAINS: Record<string, string> = {
  ramp: "ramp.com",
  numeric: "numeric.io",
  linear: "linear.app",
  walmart: "walmart.com",
  boeing: "boeing.com",
  "cvs health": "cvshealth.com",
  medtronic: "medtronic.com",
  "bosch group": "bosch.com",
  bosch: "bosch.com",
  sgs: "sgs.com",
  "red bull": "redbull.com",
  nbcuniversal: "nbcuniversal.com",
  visa: "visa.com",
  ubisoft: "ubisoft.com",
  "h&m group": "hm.com",
  "h&m": "hm.com",
  "mcdonald's corporation": "mcdonalds.com",
  "mcdonald's": "mcdonalds.com",
};

const ATS_HOSTS = [
  "ashbyhq.com",
  "greenhouse.io",
  "lever.co",
  "myworkdayjobs.com",
  "smartrecruiters.com",
  "workable.com",
  "recruitee.com",
  "jobicy.com",
  "arbeitnow.com",
];

function favicon(domain: string) {
  return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=128`;
}

function sourceDomain(url: string | null) {
  if (!url) return null;
  try {
    const hostname = new URL(url).hostname.replace(/^www\./, "");
    if (ATS_HOSTS.some((host) => hostname === host || hostname.endsWith(`.${host}`))) {
      return null;
    }
    return hostname;
  } catch {
    return null;
  }
}

export default function CompanyLogo({
  company,
  logoUrl,
  sourceUrl,
}: {
  company: string;
  logoUrl: string | null;
  sourceUrl: string | null;
}) {
  const knownDomain = COMPANY_DOMAINS[company.trim().toLowerCase()] ?? null;
  const inferredDomain = sourceDomain(sourceUrl);
  const candidates = [
    logoUrl,
    knownDomain ? favicon(knownDomain) : null,
    inferredDomain ? favicon(inferredDomain) : null,
  ].filter((value, index, array): value is string => Boolean(value) && array.indexOf(value) === index);

  const [index, setIndex] = useState(0);
  const current = candidates[index] ?? null;

  return (
    <span className="public-job-logo" aria-hidden="true">
      {current ? (
        <img
          src={current}
          alt=""
          loading="lazy"
          referrerPolicy="no-referrer"
          onError={() => setIndex((value) => value + 1)}
        />
      ) : (
        company.charAt(0).toUpperCase()
      )}
    </span>
  );
}
