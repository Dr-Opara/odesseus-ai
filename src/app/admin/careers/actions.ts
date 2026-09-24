"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isAdmin } from "@/lib/partners/service";
import { careersService } from "@/lib/careers/service";

export async function updateCareerApplicationStatus(formData: FormData) {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getClaims();
  const userId = auth?.claims?.sub;
  if (!userId) redirect("/login");
  if (!(await isAdmin(userId))) redirect("/dashboard");
  const id = String(formData.get("application_id") || "");
  const status = String(formData.get("status") || "");
  if (!id || !["submitted","reviewing","shortlisted","interview","offer","hired","rejected","withdrawn"].includes(status)) return;
  await careersService().from("career_applications").update({ status, updated_at: new Date().toISOString() }).eq("id", id);
  revalidatePath("/admin/careers");
}
