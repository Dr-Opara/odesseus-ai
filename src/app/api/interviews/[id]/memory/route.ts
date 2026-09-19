import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { generateRoundHandoff } from "@/lib/ai/round-handoff";

const schema = z.object({
  questionsAsked: z.array(z.string().trim().min(1).max(1000)).max(30),
  topicsDiscussed: z.array(z.string().trim().min(1).max(1000)).max(30),
  experiencesUsed: z.array(z.string().trim().min(1).max(1000)).max(30),
  interviewerSignals: z.array(z.string().trim().min(1).max(1000)).max(30),
  commitments: z.array(z.string().trim().min(1).max(1000)).max(30),
  candidateNotes: z.string().trim().max(10000).nullable(),
  markCompleted: z.boolean().default(true),
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
    return NextResponse.json({ error: "Check the round notes." }, { status: 400 });
  }

  const { data: interview } = await supabase
    .from("interviews")
    .select("*,applications(*)")
    .eq("id", id)
    .eq("user_id", userId)
    .maybeSingle();

  if (!interview?.applications) {
    return NextResponse.json({ error: "Interview not found." }, { status: 404 });
  }

  const service = createServiceClient();

  const { data: existingMemory } = await service
    .from("interview_round_memory")
    .select("id,round_number")
    .eq("interview_id", id)
    .eq("user_id", userId)
    .maybeSingle();

  let roundNumber =
    interview.round_number ||
    existingMemory?.round_number ||
    null;

  if (!roundNumber) {
    const { count } = await service
      .from("interview_round_memory")
      .select("id", { count: "exact", head: true })
      .eq("application_id", interview.application_id)
      .eq("user_id", userId);

    roundNumber = (count ?? 0) + 1;
  }

  try {
    const handoff = await generateRoundHandoff({
      companyName: interview.applications.company_name,
      roleTitle: interview.applications.role_title,
      jobSnapshot: interview.applications.job_snapshot,
      questionsAsked: input.questionsAsked,
      topicsDiscussed: input.topicsDiscussed,
      experiencesUsed: input.experiencesUsed,
      interviewerSignals: input.interviewerSignals,
      commitments: input.commitments,
      candidateNotes: input.candidateNotes,
    });

    const values = {
      interview_id: id,
      application_id: interview.application_id,
      user_id: userId,
      round_number: roundNumber,
      questions_asked: input.questionsAsked,
      topics_discussed: input.topicsDiscussed,
      experiences_used: input.experiencesUsed,
      interviewer_signals: input.interviewerSignals,
      commitments: input.commitments,
      candidate_notes: input.candidateNotes,
      handoff_summary: handoff,
      source: "user",
      updated_at: new Date().toISOString(),
    };

    if (existingMemory) {
      await service
        .from("interview_round_memory")
        .update(values)
        .eq("id", existingMemory.id);
    } else {
      await service.from("interview_round_memory").insert(values);
    }

    await service
      .from("interviews")
      .update({
        round_number: roundNumber,
        status: input.markCompleted ? "completed" : interview.status,
        updated_at: new Date().toISOString(),
      })
      .eq("id", id)
      .eq("user_id", userId);

    return NextResponse.json({ ok: true, roundNumber });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Odysseus could not save round memory.",
      },
      { status: 500 }
    );
  }
}
