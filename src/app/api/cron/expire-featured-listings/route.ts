import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";

export const runtime = "nodejs";

/**
 * Expire paid featured listings whose window has passed.
 *
 * The listings UI already filters expired rows, but the stored `is_active`
 * flag is what capacity and analytics read, so a scheduled tick must flip
 * it. Authorized with the CRON_SECRET bearer, same as the other maintenance
 * crons. Bounded by nature (one UPDATE) and idempotent: re-running with
 * nothing expired reports zero.
 */
export async function GET(request: Request) {
  const auth = request.headers.get("authorization");
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const service = createServiceClient();
    const { data, error } = await service.rpc("expire_ended_featured_listings");

    if (error) {
      throw new Error(error.message);
    }

    const row = Array.isArray(data) ? data[0] : data;
    const expired =
      row && typeof row === "object" && "expired" in row
        ? Number((row as { expired: number }).expired) || 0
        : 0;

    return NextResponse.json({ ok: true, expired });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[ODESSEUS_FEATURED] expiry tick failed", message);
    return NextResponse.json({ error: "Featured expiry tick failed." }, { status: 500 });
  }
}
