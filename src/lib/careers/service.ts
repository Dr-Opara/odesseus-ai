import { createServiceClient } from "@/lib/supabase/service";

export function careersService() {
  return createServiceClient() as any;
}

export async function getCareerRole(slug: string) {
  const service = careersService();
  const { data: role } = await service.from("career_roles").select("*").eq("slug", slug).maybeSingle();
  if (!role) return null;
  const { count } = await service.from("career_applications").select("id", { count: "exact", head: true }).eq("role_id", role.id).neq("status", "withdrawn");
  return { ...role, application_count: count || 0, remaining: Math.max(0, role.application_limit - (count || 0)) };
}

export async function listCareerRoles() {
  const service = careersService();
  const { data: roles } = await service.from("career_roles").select("*").order("created_at", { ascending: true });
  return Promise.all((roles || []).map(async (role: any) => {
    const { count } = await service.from("career_applications").select("id", { count: "exact", head: true }).eq("role_id", role.id).neq("status", "withdrawn");
    return { ...role, application_count: count || 0, remaining: Math.max(0, role.application_limit - (count || 0)) };
  }));
}
