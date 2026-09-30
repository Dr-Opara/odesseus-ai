import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

const requestSchema = z.object({
  status: z.enum(["discovered", "saved", "rejected"]),
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

  // Checked here rather than left to the query: a malformed id reaches
  // Postgres as a `uuid` cast and comes back as an unhandled error, which reads
  // as a server fault rather than as an id that names nothing.
  if (!z.string().uuid().safeParse(id).success) {
    return NextResponse.json({ error: "That job could not be found." }, { status: 404 });
  }

  let input: z.infer<typeof requestSchema>;
  try {
    input = requestSchema.parse(await request.json());
  } catch {
    return NextResponse.json({ error: "Invalid job status." }, { status: 400 });
  }

  // `select` is what makes the difference between "updated" and "matched
  // nothing". Without it a cross-user or nonexistent id updates zero rows and
  // still reports success, because only the error is inspected -- so the client
  // is told a status changed when nothing was written. The `.eq("user_id")`
  // below is what keeps the write scoped to the caller; this asks whether it
  // actually matched.
  const { data: updated, error } = await supabase
    .from("job_opportunities")
    .update({ status: input.status, updated_at: new Date().toISOString() })
    .eq("id", id)
    .eq("user_id", userId)
    .select("id, status")
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: "Odesseus could not update this job." }, { status: 500 });
  }

  // Not a member check on purpose: this row belongs to the caller or to nobody.
  // Saying "not found" for both avoids confirming that another candidate is
  // tracking a given job.
  if (!updated) {
    return NextResponse.json({ error: "That job could not be found." }, { status: 404 });
  }

  return NextResponse.json({ ok: true, status: updated.status });
}
