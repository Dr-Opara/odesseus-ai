import { NextResponse } from "next/server";
import { z } from "zod";
import { authorizeDesktopRequest } from "@/lib/live/desktop-auth";
import { appendTranscriptItem } from "@/lib/live/transcript";

const schema = z.object({
  itemId: z.string().min(1).max(300),
  transcript: z.string().trim().min(1).max(12000),
  mode: z.enum(["default", "star", "shorter", "technical", "follow_up", "manual"]).default("default"),
  forceGuidance: z.boolean().default(false),
  turnIndex: z.number().int().min(0).optional(),
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
    return NextResponse.json({ error: "Invalid transcript item." }, { status: 400 });
  }

  const result = await appendTranscriptItem(auth.service, {
    session: auth.liveSession,
    userId: auth.liveSession.user_id,
    turn: {
      sessionId: auth.liveSession.id,
      ...input,
    },
  });

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  return NextResponse.json(result.body);
}
