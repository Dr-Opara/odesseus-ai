import { NextResponse } from "next/server";
import { z } from "zod";
import { authorizeDesktopRequest } from "@/lib/live/desktop-auth";
import { readLiveEntitlement } from "@/lib/billing/live-entitlement";
import { mintRealtimeCall } from "@/lib/live/webrtc";

const schema = z.object({
  sdp: z.string().min(20),
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
    return NextResponse.json({ error: "Invalid WebRTC offer." }, { status: 400 });
  }

  if (!process.env.OPENAI_API_KEY) {
    return NextResponse.json({ error: "OpenAI Realtime is not configured." }, { status: 500 });
  }

  if (auth.liveSession.status !== "active") {
    const entitlement = await readLiveEntitlement(auth.liveSession.user_id);
    if (!entitlement.ok) {
      return NextResponse.json({ error: "Odesseus could not check Live access." }, { status: 500 });
    }
    if (!entitlement.row.has_access) {
      return NextResponse.json({ error: "No Live access is available." }, { status: 402 });
    }
  }

  const result = await mintRealtimeCall(auth.service, {
    sessionId: auth.liveSession.id,
    safetySeed: `odesseus:${auth.liveSession.user_id}`,
    sdp: input.sdp,
    contextSnapshot: auth.liveSession.context_snapshot,
    currentStatus: auth.liveSession.status,
  });

  if (!result.ok) {
    return NextResponse.json(
      { error: result.error, detail: result.detail },
      { status: result.status }
    );
  }

  return NextResponse.json({ sdp: result.sdp, id: result.id }, { status: 201 });
}
