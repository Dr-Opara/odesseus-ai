import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { syncGoogleForUser } from "@/lib/integrations/google-sync";

export async function POST() {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getClaims();
  const userId = auth?.claims?.sub;

  if (!userId) {
    return NextResponse.json({ error: "Please sign in again." }, { status: 401 });
  }

  try {
    const result = await syncGoogleForUser(userId);
    return NextResponse.json({ ok: true, ...result });
  } catch {
    return NextResponse.json(
      { error: "Odysseus could not sync Google. Reconnect the integration if needed." },
      { status: 500 }
    );
  }
}
