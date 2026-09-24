import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { isAdmin } from "@/lib/partners/service";
import { careersService } from "@/lib/careers/service";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getClaims();
  const userId = auth?.claims?.sub;
  if (!userId || !(await isAdmin(userId))) return new NextResponse("Not found", { status: 404 });
  const { id } = await params;
  const service = careersService();
  const { data: application } = await service.from("career_applications").select("resume_path,full_name").eq("id", id).maybeSingle();
  if (!application) return new NextResponse("Not found", { status: 404 });
  const { data, error } = await service.storage.from("career-resumes").createSignedUrl(application.resume_path, 60);
  if (error || !data?.signedUrl) return new NextResponse("Unable to open resume", { status: 500 });
  return NextResponse.redirect(data.signedUrl);
}
