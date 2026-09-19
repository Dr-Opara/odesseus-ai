import { createHash } from "crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";

const schema = z.object({
  sessionId: z.string().uuid(),
  sdp: z.string().min(20),
});

export const runtime = "nodejs";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getClaims();
  const userId = auth?.claims?.sub;

  if (!userId) {
    return NextResponse.json({ error: "Please sign in again." }, { status: 401 });
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

  const service = createServiceClient();
  const [{ data: liveSession }, { data: credits }] = await Promise.all([
    service
      .from("live_interview_sessions")
      .select("id,status,capture_mode,context_snapshot")
      .eq("id", input.sessionId)
      .eq("interview_id", id)
      .eq("user_id", userId)
      .maybeSingle(),
    service
      .from("credit_balances")
      .select("interview_passes")
      .eq("user_id", userId)
      .maybeSingle(),
  ]);

  if (!liveSession) {
    return NextResponse.json({ error: "Live session not found." }, { status: 404 });
  }

  if (liveSession.status !== "active" && (credits?.interview_passes ?? 0) < 1) {
    return NextResponse.json({ error: "No interview pass is available." }, { status: 402 });
  }

  const context = liveSession.context_snapshot as any;
  const company = context?.application?.companyName || "the employer";
  const role = context?.application?.roleTitle || "the role";
  const keywords = [
    company,
    role,
    ...(context?.application?.resumeSnapshot?.parsed_data?.content?.skills || []).slice(0, 20),
  ]
    .map((value: unknown) => String(value || "").replace(/[<>\r\n]/g, " ").trim())
    .filter(Boolean)
    .slice(0, 30);

  const sessionConfig = {
    type: "transcription",
    audio: {
      input: {
        transcription: {
          model: "gpt-live-transcribe",
          prompt: `A professional job interview for ${role} at ${company}. Transcribe interview questions and discussion accurately.`,
          keywords,
          languages: ["en"],
          delay: "low",
        },
        turn_detection: {
          type: "server_vad",
          threshold: 0.5,
          prefix_padding_ms: 300,
          silence_duration_ms: 650,
        },
      },
    },
  };

  const form = new FormData();
  form.set("sdp", input.sdp);
  form.set("session", JSON.stringify(sessionConfig));

  const safetyId = createHash("sha256")
    .update(`odysseus:${userId}`)
    .digest("hex");

  const response = await fetch("https://api.openai.com/v1/realtime/calls", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      "OpenAI-Safety-Identifier": safetyId,
    },
    body: form,
  });

  const body = await response.text();

  if (!response.ok) {
    await service
      .from("live_interview_sessions")
      .update({
        status: liveSession.status === "active" ? "active" : "failed",
        error_message: "OpenAI Realtime session creation failed.",
        updated_at: new Date().toISOString(),
      })
      .eq("id", liveSession.id);

    return NextResponse.json(
      {
        error: "OpenAI Realtime session creation failed.",
        detail: body.slice(0, 1000),
      },
      { status: response.status }
    );
  }

  return NextResponse.json(
    {
      sdp: body,
      id:
        response.headers.get("openai-session-id") ||
        response.headers.get("x-request-id") ||
        `realtime:${liveSession.id}`,
    },
    { status: 201 }
  );
}
