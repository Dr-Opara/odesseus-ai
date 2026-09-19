import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { runAutomaticJobDiscovery } from "@/lib/jobs/discovery";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST() {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getClaims();
  const userId = auth?.claims?.sub;

  if (!userId) {
    return NextResponse.json({ error: "Please sign in again." }, { status: 401 });
  }

  try {
    const result = await runAutomaticJobDiscovery({ userIds: [userId] });
    return NextResponse.json(result);
  } catch (error) {
    console.error("[ODYSSEUS_JOB_DISCOVERY] manual discovery failed", error);
    return NextResponse.json(
      { error: "Odysseus could not refresh job matches." },
      { status: 500 }
    );
  }
}
