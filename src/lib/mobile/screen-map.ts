export type MobileScreenSpec = {
  index: string;
  name: string;
  nodeId: string;
  minHeight: number;
  /** True when the route renders a real mobile presentation (Phase 5
   * backend-integrated screens) instead of the fallback desktop layout. */
  wired: boolean;
};

export const mobileScreens: MobileScreenSpec[] = [
  ["00","Splash","32:2",844,0],
  ["01","Sign Up","3:2",844,0],
  ["02","Your Name","3:26",844,0],
  ["03","Resume","3:53",844,0],
  ["04","Preferences","3:75",844,0],
  ["05","Home","45:2",990,1],
  ["06","Match","45:30",844,1],
  ["07","Match Results","45:54",844,1],
  ["08","Resume Review","45:82",844,1],
  ["09","Approval","45:106",844,1],
  ["10","Applications","45:131",844,1],
  ["11","Prep Agent","45:157",844,1],
  ["12","Profile","45:185",844,1],
  ["14","Account Settings","65:36",844,1],
  ["15","Password & Security","65:77",844,1],
  ["16","Notifications","65:110",844,1],
  ["17","Job Preferences","65:156",950,1],
  ["18","Documents","65:192",844,1],
  ["19","Language & Region","65:215",844,1],
  ["20","Appearance","65:244",844,1],
  ["21","Refer a Friend","65:264",844,1],
  ["22","Legal","66:2",844,1],
  ["23","Terms of Service","66:31",844,1],
  ["24","Privacy Policy","66:48",844,1],
  ["25","Accessibility Statement","66:65",844,1],
  ["26","Open-Source Licenses","66:83",844,1],
  ["27","FAQ","66:103",844,1],
  ["28","Help & Support","66:127",844,1],
  ["29","About Odesseus.ai","66:161",1114,1],
  ["30","Pricing","88:2",1040,1],
  ["31","Select Countries","195:2",1220,1],
  ["32","Work Authorization","197:2",844,1],
  ["33","Report Job","225:2",1018,1],
].map(([index,name,nodeId,minHeight,wired]) => ({
  index: index as string,
  name: name as string,
  nodeId: nodeId as string,
  minHeight: minHeight as number,
  wired: Boolean(wired),
}));

const byIndex = new Map(mobileScreens.map((screen) => [screen.index, screen]));

export function resolveMobileScreen(pathname: string): MobileScreenSpec | null {
  const explicit = pathname.match(/^\/mobile\/(\d{2})\/?$/);
  if (explicit) return byIndex.get(explicit[1]) ?? null;

  if (pathname === "/") return byIndex.get("00") ?? null;
  if (pathname === "/dashboard") return byIndex.get("05") ?? null;
  if (pathname === "/jobs") return byIndex.get("06") ?? null;
  if (/^\/match\//.test(pathname)) return byIndex.get("07") ?? null;
  if (/^\/resume-tailoring\//.test(pathname)) return byIndex.get("08") ?? null;
  if (pathname === "/apply/start" || /^\/apply\/run\//.test(pathname)) return byIndex.get("09") ?? null;
  if (pathname === "/applications") return byIndex.get("10") ?? null;
  if (pathname === "/interviews") return byIndex.get("11") ?? null;
  if (pathname === "/profile") return byIndex.get("12") ?? null;
  if (pathname === "/settings") return byIndex.get("14") ?? null;
  if (pathname === "/settings/security") return byIndex.get("15") ?? null;
  if (pathname === "/settings/notifications") return byIndex.get("16") ?? null;
  if (pathname === "/settings/job-preferences") return byIndex.get("17") ?? null;
  if (pathname === "/settings/documents") return byIndex.get("18") ?? null;
  if (pathname === "/settings/language-region") return byIndex.get("19") ?? null;
  if (pathname === "/settings/appearance") return byIndex.get("20") ?? null;
  if (pathname === "/settings/referrals") return byIndex.get("21") ?? null;
  if (pathname === "/legal") return byIndex.get("22") ?? null;
  if (pathname === "/terms") return byIndex.get("23") ?? null;
  if (pathname === "/privacy") return byIndex.get("24") ?? null;
  if (pathname === "/accessibility") return byIndex.get("25") ?? null;
  if (pathname === "/licenses") return byIndex.get("26") ?? null;
  if (pathname === "/faq") return byIndex.get("27") ?? null;
  if (pathname === "/support") return byIndex.get("28") ?? null;
  if (pathname === "/about") return byIndex.get("29") ?? null;
  if (pathname === "/pricing") return byIndex.get("30") ?? null;
  if (pathname === "/settings/countries") return byIndex.get("31") ?? null;
  if (pathname === "/settings/work-authorization") return byIndex.get("32") ?? null;
  if (pathname === "/report-job") return byIndex.get("33") ?? null;
  return null;
}

/**
 * Fixed real-app path for a screen, for screens reachable without a record ID
 * (kept in sync with the path checks in resolveMobileScreen above). Screens
 * "07" (Match Results) and "08" (Resume Review) require a specific match/
 * resume ID and have no context-free path, so they are intentionally absent —
 * callers should fall back to the dedicated `/mobile/{index}` preview route.
 *
 * Used only by the /qa/mobile development preview to link back to the real
 * desktop route; production rendering never reads this table.
 */
export const SCREEN_REAL_PATHS: Partial<Record<string, string>> = {
  "00": "/",
  "01": "/signup",
  "02": "/onboarding",
  "03": "/onboarding",
  "04": "/onboarding",
  "05": "/dashboard",
  "06": "/jobs",
  "09": "/apply/start",
  "10": "/applications",
  "11": "/interviews",
  "12": "/profile",
  "14": "/settings",
  "15": "/settings/security",
  "16": "/settings/notifications",
  "17": "/settings/job-preferences",
  "18": "/settings/documents",
  "19": "/settings/language-region",
  "20": "/settings/appearance",
  "21": "/settings/referrals",
  "22": "/legal",
  "23": "/terms",
  "24": "/privacy",
  "25": "/accessibility",
  "26": "/licenses",
  "27": "/faq",
  "28": "/support",
  "29": "/about",
  "30": "/pricing",
  "31": "/settings/countries",
  "32": "/settings/work-authorization",
  "33": "/report-job",
};

/**
 * Named shortcuts for the /qa/mobile development preview
 * (e.g. /qa/mobile/dashboard instead of /qa/mobile/05).
 */
export const QA_MOBILE_ALIASES: Record<string, string> = {
  dashboard: "05",
  applications: "10",
  interviews: "11",
  profile: "12",
  settings: "14",
  pricing: "30",
};

export type QaMobileResolution = {
  screen: MobileScreenSpec;
  /** The real app path this QA preview mirrors, or null for screens (07, 08)
   * that require a specific record ID and have no context-free path. */
  realPath: string | null;
};

/**
 * Resolves a /qa/mobile/* pathname to the screen it previews and the real
 * app path it mirrors. Shared by the QA page (to pick what to render) and
 * the auth proxy (to require the same session as the real route), so the
 * two can never drift apart.
 */
export function resolveQaMobilePath(pathname: string): QaMobileResolution | null {
  const match = pathname.match(/^\/qa\/mobile(?:\/([^/]+))?\/?$/);
  if (!match) return null;

  const raw = match[1];
  if (!raw) {
    const screen = byIndex.get("00");
    return screen ? { screen, realPath: SCREEN_REAL_PATHS["00"] ?? null } : null;
  }

  const index = /^\d{2}$/.test(raw) ? raw : QA_MOBILE_ALIASES[raw];
  if (!index) return null;

  const screen = byIndex.get(index);
  return screen ? { screen, realPath: SCREEN_REAL_PATHS[index] ?? null } : null;
}
