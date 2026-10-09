"use client";

import { useState } from "react";

const COMPANY_DOMAINS: Record<string, string> = {
  amazon: "amazon.com",
  microsoft: "microsoft.com",
  google: "google.com",
  apple: "apple.com",
  meta: "meta.com",
  netflix: "netflix.com",
  nvidia: "nvidia.com",
  salesforce: "salesforce.com",
  oracle: "oracle.com",
  adobe: "adobe.com",
  spotify: "spotify.com",
  samsung: "samsung.com",
  sony: "sony.com",
  shopify: "shopify.com",
  "mercado libre": "mercadolibre.com",
  nubank: "nubank.com.br",
  sap: "sap.com",
  siemens: "siemens.com",
  asml: "asml.com",
  revolut: "revolut.com",
  airbus: "airbus.com",
  canva: "canva.com",
  alibaba: "alibaba.com",
  tencent: "tencent.com",
  grab: "grab.com",
  tcs: "tcs.com",
  infosys: "infosys.com",
  flutterwave: "flutterwave.com",
  mtn: "mtn.com",
  safaricom: "safaricom.co.ke",
  careem: "careem.com",
  aramco: "aramco.com",
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

function sourceDomain(url: string | null | undefined) {
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

function CompanyFallback() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M5 21V4.8c0-.5.3-.9.8-1.1l6-2.2c.6-.2 1.2.2 1.2.9V8h5.2c.4 0 .8.4.8.8V21M3 21h18M8 7h2M8 11h2M8 15h2M15 11h1.5M15 15h1.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export default function CompanyLogo({
  company,
  logoUrl = null,
  sourceUrl = null,
  className = "",
  eager = false,
}: {
  company: string;
  logoUrl?: string | null;
  sourceUrl?: string | null;
  className?: string;
  eager?: boolean;
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
    <span
      className={`company-logo${className ? ` ${className}` : ""}`}
      aria-label={`${company} logo`}
      role="img"
    >
      {current ? (
        <img
          src={current}
          alt=""
          loading={eager ? "eager" : "lazy"}
          referrerPolicy="no-referrer"
          onError={() => setIndex((value) => value + 1)}
        />
      ) : (
        <CompanyFallback />
      )}
    </span>
  );
}

export function companyDomain(company: string) {
  return COMPANY_DOMAINS[company.trim().toLowerCase()] ?? null;
}
