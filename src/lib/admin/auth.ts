import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isAdmin } from "@/lib/partners/service";

export async function requireAdmin() {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getClaims();
  const userId = auth?.claims?.sub;
  if (!userId) redirect("/login");

  const role = await isAdmin(userId);
  if (!role) redirect("/dashboard");

  return { userId, role };
}
