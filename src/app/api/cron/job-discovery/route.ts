import { NextResponse } from "next/server";
import { runAutomaticJobDiscovery } from "@/lib/jobs/discovery";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function GET(request: Request) {
  const auth = request.headers.get("authorization");

  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const result = await runAutomaticJobDiscovery();
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    console.error("[ODESSEUS_JOB_DISCOVERY] scheduled discovery failed", error);
    return NextResponse.json(
      { error: "Scheduled discovery failed." },
      { status: 500 }
    );
  }
}
