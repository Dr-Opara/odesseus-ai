import type { ReactNode } from "react";
import { requireAdmin } from "@/lib/admin/auth";
import AdminNav from "@/components/admin-nav";

export default async function AdminLayout({ children }: { children: ReactNode }) {
  const { role } = await requireAdmin();

  return (
    <>
      <AdminNav role={role} />
      {children}
    </>
  );
}
