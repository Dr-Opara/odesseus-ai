import { NextResponse } from "next/server";
import { startAuthorization } from "@vercel/connect";
import { createClient } from "@/lib/supabase/server";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const provider = url.searchParams.get("provider");

  if (provider !== "google") {
    return NextResponse.redirect(
      new URL("/integrations?error=Invalid%20send%20provider", request.url)
    );
  }

  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getClaims();
  const userId = auth?.claims?.sub;

  if (!userId) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  const connector = process.env.ODYSSEUS_CONNECT_GOOGLE_SEND_CONNECTOR;

  if (!connector) {
    return NextResponse.redirect(
      new URL(
        `/integrations?error=${encodeURIComponent(
          "Google follow-up sending is not configured."
        )}`,
        request.url
      )
    );
  }

  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL;
  if (!siteUrl) {
    return NextResponse.redirect(
      new URL("/integrations?error=Site%20URL%20is%20not%20configured", request.url)
    );
  }

  const authorization = await startAuthorization(
    connector,
    { subject: { type: "user", id: userId } },
    {
      callbackUrl:
        `${siteUrl}/integrations?outbound=google`,
    }
  );

  return NextResponse.redirect(authorization.url);
}
