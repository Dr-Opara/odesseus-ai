import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { listCountries } from "@/lib/countries/service";
import MobileCountrySelect from "@/components/mobile/mobile-country-select";

/**
 * Select Countries (screen 31). Candidate-only, mobile-first settings page —
 * there is no separate desktop UI for this yet, so it renders the mobile
 * presentation regardless of viewport. Uses the real Phase 1 country catalog
 * and saves through the existing profile localization endpoint.
 */
export default async function CountriesSettingsPage() {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getClaims();
  const userId = auth?.claims?.sub;
  if (!userId) redirect("/login");

  const [{ data: profile }, countries] = await Promise.all([
    supabase.from("profiles").select("country_code").eq("id", userId).maybeSingle(),
    listCountries(supabase),
  ]);

  return (
    <MobileCountrySelect countries={countries} initialCountryCode={profile?.country_code ?? null} />
  );
}
