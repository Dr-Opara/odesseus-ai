import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { listCountries } from "@/lib/countries/service";
import LocalizationForm from "@/components/localization-form";
import MobileLanguageRegion from "@/components/mobile/mobile-language-region";

/**
 * Language & Region (screen 19). Candidate-only settings sub-page. Reads the
 * profile localization fields and the real country catalog once server-side,
 * then renders the shared desktop form on wide viewports and the phone-width
 * mobile presentation on small screens — both save through the existing
 * `PATCH /api/profile/localization` endpoint.
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
    <>
      <main
        className="odesseus-desktop-only"
        style={{ minHeight: "100vh", padding: "24px 16px 80px" }}
      >
        <LocalizationForm countries={countries} email={email} initial={profile ?? null} />
      </main>
      <MobileLanguageRegion
        countries={countries}
        email={email}
        initial={profile ?? null}
      />
    </>
  );
}