import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import {
  GOOGLE_CONNECTOR,
  startGoogleAuthorization,
} from "@/lib/integrations/google-auth";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getClaims();
  const userId = auth?.claims?.sub;

  if (!userId) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  const origin = new URL(request.url).origin;
  const callbackUrl = `${origin}/integrations/google?connected=1`;
  const service = createServiceClient();

  await service.from("integration_connections").upsert({
    user_id: userId,
    provider: "google",
    status: "connecting",
    connector_id: GOOGLE_CONNECTOR,
    last_error: null,
    updated_at: new Date().toISOString(),
  });

  try {
    const authorization = await startGoogleAuthorization(
      userId,
      callbackUrl
    );
    return NextResponse.redirect(authorization.url);
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Google authorization could not be started.";

    await service.from("integration_connections").upsert({
      user_id: userId,
      provider: "google",
      status: "error",
      connector_id: GOOGLE_CONNECTOR,
      last_error: message.slice(0, 1000),
      updated_at: new Date().toISOString(),
    });

    return NextResponse.redirect(
      new URL(
        `/integrations/google?error=${encodeURIComponent(
          "Google connection could not be started."
        )}`,
        request.url
      )
    );
  }
}
