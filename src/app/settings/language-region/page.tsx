import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { listCountries } from "@/lib/countries/service";
import LocalizationForm from "@/components/localization-form";

/**
 * Language & Region (screen 19). Reuses the exact same LocalizationForm and
 * profile localization fields (Phase 1 global-identity) the desktop Settings
 * page uses. A dedicated Figma-styled mobile layout (this currently renders
 * the same form markup as desktop) is follow-up work.
 */
export default async function LanguageRegionSettingsPage() {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getClaims();
  const userId = auth?.claims?.sub;
  const email = typeof auth?.claims?.email === "string" ? auth.claims.email : undefined;
  if (!userId) redirect("/login");

  const [{ data: profile }, countries] = await Promise.all([
    supabase
      .from("profiles")
      .select("country_code,locale,preferred_currency,timezone,preferred_language,application_contact_email")
      .eq("id", userId)
      .maybeSingle(),
    listCountries(supabase).catch(() => []),
  ]);

  return (
    <main style={{ minHeight: "100vh", padding: "24px 16px 80px" }}>
      <LocalizationForm countries={countries} email={email} initial={profile ?? null} />
    </main>
  );
}
