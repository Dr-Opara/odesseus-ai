import { NextResponse } from "next/server";
import { authorizeDesktopRequest } from "@/lib/live/desktop-auth";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const auth = await authorizeDesktopRequest(request);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const { error } = await auth.service.rpc("odesseus_complete_live_session", {
    p_session_id: auth.liveSession.id,
    p_user_id: auth.liveSession.user_id,
  });

  if (error) {
    return NextResponse.json(
      { error: "Odesseus could not end the session cleanly." },
      { status: 500 }
    );
  }

  await auth.service
    .from("live_desktop_sessions")
    .update({
      revoked_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", auth.desktopSession.id);

  return NextResponse.json({
    ok: true,
    interviewId: auth.liveSession.interview_id,
    analysisUrl: `/interviews/${auth.liveSession.interview_id}/analysis`,
  });
}
