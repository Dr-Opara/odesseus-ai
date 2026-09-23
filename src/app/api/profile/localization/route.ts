import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  LOCALIZATION_FIELDS,
  emptyLocalization,
  pickLocalizationFields,
} from "@/lib/profile/localization";

export const runtime = "nodejs";

const RETURNING = LOCALIZATION_FIELDS.join(",");

/**
 * Reads the signed-in user's six localization fields. Scoped to
 * auth getClaims + an `id = userId` filter, so a user can only ever read
 * their own row (RLS owner-only policies back this up).
 */
export async function GET() {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getClaims();
  const userId = auth?.claims?.sub;

  if (!userId) {
    return NextResponse.json({ error: "Please sign in again." }, { status: 401 });
  }

  const { data, error } = await supabase
    .from("profiles")
    .select(RETURNING)
    .eq("id", userId)
    .maybeSingle();

  if (error) {
    return NextResponse.json(
      { error: "Could not load your settings." },
      { status: 500 }
    );
  }

  const stored = (data ?? {}) as Partial<
    Record<(typeof LOCALIZATION_FIELDS)[number], string | null>
  >;

  return NextResponse.json({
    localization: { ...emptyLocalization(), ...stored },
  });
}

/**
 * Updates the signed-in user's localization fields. Only the six whitelisted
 * columns can ever be written: unknown keys are stripped by validation, the
 * update is built from LOCALIZATION_FIELDS, and it runs through the
 * user-scoped client (never the service role) with an `id = userId` filter.
 */
export async function PATCH(request: Request) {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getClaims();
  const userId = auth?.claims?.sub;

  if (!userId) {
    return NextResponse.json({ error: "Please sign in again." }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    body = null;
  }

  let update: ReturnType<typeof pickLocalizationFields>;
  try {
    update = pickLocalizationFields(body);
  } catch {
    return NextResponse.json(
      { error: "Check the location and language details." },
      { status: 400 }
    );
  }

  if (Object.keys(update).length === 0) {
    return NextResponse.json(
      { error: "Nothing to update." },
      { status: 400 }
    );
  }

  const { data, error } = await supabase
    .from("profiles")
    .upsert({
      id: userId,
      ...update,
      updated_at: new Date().toISOString(),
    })
    .select(RETURNING)
    .maybeSingle();

  if (error) {
    return NextResponse.json(
      { error: "Odesseus could not save your settings." },
      { status: 500 }
    );
  }

  if (!data) {
    return NextResponse.json(
      { error: "Your profile could not be found." },
      { status: 404 }
    );
  }

  return NextResponse.json({ localization: data });
}
