import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";

const schema = z.object({
  interviewType: z.enum([
    "recruiter",
    "hiring_manager",
    "behavioral",
    "technical",
    "panel",
    "executive",
    "case_study",
    "coding",
    "cybersecurity_grc",
    "software_engineering",
    "ai_ml",
    "agile_product",
    "other",
  ]),
  responseStyle: z.enum([
    "concise",
    "conversational",
    "detailed",
    "star",
    "executive",
    "technical",
  ]),
  responseLength: z.enum([
    "15_30",
    "30_45",
    "45_60",
    "detailed",
  ]),
  durationMinutes: z.number().int().min(5).max(480).nullable(),
});

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
    return NextResponse.json({ error: "Check the interview settings." }, { status: 400 });
  }

  const { data: interview } = await supabase
    .from("interviews")
    .select("id")
    .eq("id", id)
    .eq("user_id", userId)
    .maybeSingle();

  if (!interview) {
    return NextResponse.json({ error: "Interview not found." }, { status: 404 });
  }

  const service = createServiceClient();
  const { error } = await service
    .from("interviews")
    .update({
      interview_type: input.interviewType,
      response_style: input.responseStyle,
      response_length: input.responseLength,
      duration_minutes: input.durationMinutes,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id)
    .eq("user_id", userId);

  if (error) {
    return NextResponse.json({ error: "Odysseus could not save these settings." }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
