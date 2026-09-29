import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";

const createInterviewSchema = z.object({
  company: z.string().trim().min(1),
  roleTitle: z.string().trim().min(1),
  scheduledAt: z.string().datetime().nullable(),
  timezone: z.string().nullable(),
  round: z.string().nullable(),
  notes: z.string().trim().max(5000).nullable(),
  applicationId: z.string().uuid().nullable(),
  applicationUrl: z.string().trim().nullable(),
  meetingProvider: z
    .enum(["google_meets", "teams", "zoom", "phone", "onsite", "async"])
    .nullable(),
  meetingUrl: z.string().trim().nullable(),
  source: z.enum(["email", "calendar", "manual"]).default("manual"),
  status: z.enum(["invited", "scheduled", "ready", "live", "completed", "cancelled", "rescheduled"]).default("scheduled"),
});

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getClaims();
  const userId = auth?.claims?.sub;

  if (!userId) {
    return NextResponse.json({ error: "Please sign in again." }, { status: 401 });
  }

  let input: z.infer<typeof createInterviewSchema>;
  try {
    input = createInterviewSchema.parse(await request.json());
  } catch {
    return NextResponse.json({ error: "Invalid interview creation payload." }, { status: 400 });
  }

  const service = createServiceClient();

  // If application_id is provided, verify ownership
  if (input.applicationId) {
    const { data: app } = await service
      .from("applications")
      .select("id, user_id")
      .eq("id", input.applicationId)
      .eq("user_id", userId)
      .maybeSingle();

    if (!app) {
      return NextResponse.json({ error: "Application not found or access denied." }, { status: 403 });
    }
  }

  const parsedRound = input.round !== null ? Number(input.round) : null;
  const roundNumber =
    parsedRound !== null && Number.isFinite(parsedRound) ? parsedRound : null;

  const { data: interview, error } = await service
    .from("interviews")
    .insert({
      user_id: userId,
      application_id: input.applicationId ?? null,
      stage: input.status,
      scheduled_at: input.scheduledAt,
      timezone: input.timezone,
      round_number: roundNumber,
      notes: input.notes,
      source: input.source,
      status: input.status,
      company: input.company,
      role_title: input.roleTitle,
      meeting_provider: input.meetingProvider,
      meeting_url: input.meetingUrl,
      application_url: input.applicationUrl,
    })
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: "Failed to create interview." }, { status: 500 });
  }

  return NextResponse.json({ interview });
}