import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { syncGoogleForUser } from "@/lib/integrations/google-sync";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function GET(request: Request) {
  const auth = request.headers.get("authorization");

  if (
    !process.env.CRON_SECRET ||
    auth !== `Bearer ${process.env.CRON_SECRET}`
  ) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const service = createServiceClient();
  const { data: connections } = await service
    .from("integration_connections")
    .select("user_id")
    .eq("provider", "google")
    .eq("status", "connected");

  let synced = 0;
  let failed = 0;

  for (const connection of connections || []) {
    try {
      await syncGoogleForUser(connection.user_id);
      synced += 1;
    } catch (error) {
      console.error(
        "[ODESSEUS_GOOGLE_SYNC] scheduled user sync failed",
        error
      );
      failed += 1;
    }
  }

  return NextResponse.json({ ok: true, synced, failed });
}
