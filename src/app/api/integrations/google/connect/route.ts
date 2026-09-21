import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { startGoogleAuthorization } from "@/lib/integrations/google-auth";

export async function GET(request: Request) {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getClaims();
  const userId = auth?.claims?.sub;

  if (!userId) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL;
  if (!siteUrl) {
    return NextResponse.redirect(
      new URL("/integrations/google?error=Integration%20is%20not%20configured", request.url)
    );
  }

  const service = createServiceClient();
  await service.from("integration_connections").upsert({
    user_id: userId,
    provider: "google",
    status: "connecting",
    connector_id: process.env.ODESSEUS_CONNECT_GOOGLE_CONNECTOR || null,
    updated_at: new Date().toISOString(),
  });

  const authorization = await startGoogleAuthorization(
    userId,
    `${siteUrl}/integrations/google?connected=1`
  );

  return NextResponse.redirect(authorization.url);
}
