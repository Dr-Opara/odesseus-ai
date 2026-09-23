import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";

export type Country = {
  code: string;
  name: string;
  default_currency: string;
  default_locale: string;
  calling_code: string | null;
  active: boolean;
};

const COUNTRY_COLUMNS =
  "code,name,default_currency,default_locale,calling_code,active" as const;

type CountryClient = SupabaseClient<Database>;

/**
 * Returns the canonical country dataset, ordered by name.
 *
 * Reads against `countries` are allowed for every role (the table is public
 * reference data); writes are only possible server-side because no client
 * write policy exists. Pass any Supabase client — no service-role key is
 * required for reads.
 */
export async function listCountries(
  client: CountryClient,
  options: { activeOnly?: boolean } = {}
): Promise<Country[]> {
  const activeOnly = options.activeOnly ?? true;

  let query = client.from("countries").select(COUNTRY_COLUMNS);
  if (activeOnly) {
    query = query.eq("active", true);
  }

  const { data, error } = await query.order("name", { ascending: true });

  if (error) {
    throw new Error(`Could not load countries: ${error.message}`);
  }

  return (data ?? []) as Country[];
}

/** Looks up a single country by ISO alpha-2 code (case-insensitive). */
export async function getCountry(
  client: CountryClient,
  code: string
): Promise<Country | null> {
  const normalized = code.trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(normalized)) return null;

  const { data, error } = await client
    .from("countries")
    .select(COUNTRY_COLUMNS)
    .eq("code", normalized)
    .maybeSingle();

  if (error) {
    throw new Error(`Could not load country: ${error.message}`);
  }

  return (data as Country) ?? null;
}
