import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { revokeGoogleAccess } from "@/lib/integrations/google-auth";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getClaims();
  const userId = auth?.claims?.sub;

  if (!userId) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  try {
    await revokeGoogleAccess(userId);
  } catch (error) {
    console.warn("[ODESSEUS_GOOGLE_SYNC] token revocation failed", error);
  }

  const service = createServiceClient();
  await service.from("integration_connections").upsert({
    user_id: userId,
    provider: "google",
    status: "disconnected",
    last_error: null,
    updated_at: new Date().toISOString(),
  });

  return NextResponse.redirect(
    new URL("/integrations/google?disconnected=1", request.url),
    303
  );
}
