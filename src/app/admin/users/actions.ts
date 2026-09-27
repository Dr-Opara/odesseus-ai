"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/admin/auth";
import { createServiceClient } from "@/lib/supabase/service";

function text(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : "";
}

export async function suspendUser(formData: FormData) {
  await requireAdmin();
  const userId = text(formData, "user_id");
  if (!userId) return;

  const service = createServiceClient();
  await service.auth.admin.updateUserById(userId, { ban_duration: "876000h" });

  revalidatePath("/admin/users");
  revalidatePath(`/admin/users/${userId}`);
}

export async function unsuspendUser(formData: FormData) {
  await requireAdmin();
  const userId = text(formData, "user_id");
  if (!userId) return;

  const service = createServiceClient();
  await service.auth.admin.updateUserById(userId, { ban_duration: "none" });

  revalidatePath("/admin/users");
  revalidatePath(`/admin/users/${userId}`);
}
