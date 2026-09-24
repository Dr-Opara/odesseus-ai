export type MobileScreenSpec = {
  index: string;
  name: string;
  nodeId: string;
  minHeight: number;
};

export const mobileScreens: MobileScreenSpec[] = [
  ["00","Splash","32:2",844],
  ["01","Sign Up","3:2",844],
  ["02","Your Name","3:26",844],
  ["03","Resume","3:53",844],
  ["04","Preferences","3:75",844],
  ["05","Home","45:2",990],
  ["06","Match","45:30",844],
  ["07","Match Results","45:54",844],
  ["08","Resume Review","45:82",844],
  ["09","Approval","45:106",844],
  ["10","Applications","45:131",844],
  ["11","Prep Agent","45:157",844],
  ["12","Profile","45:185",844],
  ["14","Account Settings","65:36",844],
  ["15","Password & Security","65:77",844],
  ["16","Notifications","65:110",844],
  ["17","Job Preferences","65:156",950],
  ["18","Documents","65:192",844],
  ["19","Language & Region","65:215",844],
  ["20","Appearance","65:244",844],
  ["21","Refer a Friend","65:264",844],
  ["22","Legal","66:2",844],
  ["23","Terms of Service","66:31",844],
  ["24","Privacy Policy","66:48",844],
  ["25","Accessibility Statement","66:65",844],
  ["26","Open-Source Licenses","66:83",844],
  ["27","FAQ","66:103",844],
  ["28","Help & Support","66:127",844],
  ["29","About Odesseus.ai","66:161",1114],
  ["30","Pricing","88:2",1040],
  ["31","Select Countries","195:2",1220],
  ["32","Work Authorization","197:2",844],
  ["33","Report Job","225:2",1018],
].map(([index,name,nodeId,minHeight]) => ({
  index: index as string,
  name: name as string,
  nodeId: nodeId as string,
  minHeight: minHeight as number,
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
