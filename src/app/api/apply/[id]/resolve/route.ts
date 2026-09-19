import { NextResponse } from "next/server";
import { z } from "zod";
import { resumeHook } from "workflow/api";
import { createClient } from "@/lib/supabase/server";

const schema = z.object({
  answers: z.array(
    z.object({
      questionId: z.string().uuid(),
      answer: z.string().trim().min(1).max(4000),
      remember: z.boolean().default(false),
    })
  ).min(1),
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
    return NextResponse.json({ error: "Complete the unanswered fields." }, { status: 400 });
  }

  const { data: run } = await supabase
    .from("application_runs")
    .select("id,status,resume_token")
    .eq("id", id)
    .eq("user_id", userId)
    .maybeSingle();

  if (!run || run.status !== "needs_user") {
    return NextResponse.json({ error: "This application is not waiting for answers." }, { status: 409 });
  }

  const ids = input.answers.map((item) => item.questionId);
  const { data: questions } = await supabase
    .from("application_run_questions")
    .select("id,field_key,question_text,category,status")
    .eq("run_id", id)
    .eq("user_id", userId)
    .in("id", ids);

  if (!questions || questions.length !== ids.length) {
    return NextResponse.json({ error: "One or more questions could not be verified." }, { status: 400 });
  }

  for (const answer of input.answers) {
    const question = questions.find((item) => item.id === answer.questionId);
    if (!question || question.status !== "needs_user") continue;

    await supabase
      .from("application_run_questions")
      .update({
        answer_text: answer.answer,
        answer_source: "user",
        status: "resolved",
        resolved_at: new Date().toISOString(),
        auto_reuse_allowed: answer.remember && question.category !== "sensitive",
      })
      .eq("id", question.id)
      .eq("user_id", userId);

    if (answer.remember && question.category !== "sensitive" && question.field_key) {
      await supabase.from("application_answer_vault").upsert(
        {
          user_id: userId,
          answer_key: question.field_key,
          label: question.question_text,
          category: question.category === "sensitive" ? "custom" : question.category,
          answer_text: answer.answer,
          auto_use_allowed: true,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "user_id,answer_key" }
      );
    }
  }

  if (!run.resume_token) {
    return NextResponse.json({ error: "Odysseus is not ready to resume yet." }, { status: 409 });
  }

  await resumeHook(run.resume_token, { action: "continue" });
  return NextResponse.json({ ok: true });
}
