import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { listCountries } from "@/lib/countries/service";

export const runtime = "nodejs";

/**
 * Public, read-only country reference data for pickers and onboarding.
 * No session is required; RLS allows SELECT and blocks client writes.
 */
export async function GET() {
  try {
    const supabase = await createClient();
    const countries = await listCountries(supabase);

    return NextResponse.json(
      { countries },
      { headers: { "Cache-Control": "public, max-age=3600" } }
    );
  } catch {
    return NextResponse.json(
      { error: "Could not load countries right now." },
      { status: 500 }
    );
  }
}
