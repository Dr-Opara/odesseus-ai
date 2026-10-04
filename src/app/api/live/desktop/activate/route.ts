import { NextResponse } from "next/server";
import { z } from "zod";
import { authorizeDesktopRequest } from "@/lib/live/desktop-auth";

const schema = z.object({
  openaiSessionId: z.string().min(3),
});

export const runtime = "nodejs";

export async function POST(request: Request) {
  const auth = await authorizeDesktopRequest(request);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  let input: z.infer<typeof schema>;
  try {
    input = schema.parse(await request.json());
  } catch {
    return NextResponse.json({ error: "Invalid Live activation." }, { status: 400 });
  }

  const { data, error } = await auth.service.rpc("odesseus_activate_live_session_v2", {
    p_session_id: auth.liveSession.id,
    p_user_id: auth.liveSession.user_id,
    p_openai_session_id: input.openaiSessionId,
  });

  if (error) {
    const msg = error.message?.toLowerCase() || "";
    const insufficient =
      msg.includes("insufficient") ||
      msg.includes("no live entitlement") ||
      msg.includes("fair use limit");
    return NextResponse.json(
      { error: insufficient ? "No Live access is available." : "Odesseus could not activate Live." },
      { status: insufficient ? 402 : 500 }
    );
  }

  const row = data?.[0];
  return NextResponse.json({
    ok: true,
    session: row?.session,
    entitlementConsumed: row?.entitlement_consumed ?? false,
    entitlementType: row?.entitlement_type ?? null,
    passesRemaining: row?.passes_remaining ?? null,
  });
}
