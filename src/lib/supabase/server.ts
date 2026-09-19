import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import type { Database } from "@/types/database";
import { publicSupabaseUrl, publicSupabasePublishableKey } from "@/lib/supabase/public-config";

export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient<Database>(
    publicSupabaseUrl,
    publicSupabasePublishableKey,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            );
          } catch {
            // Server Components cannot write cookies.
          }
        },
      },
    }
  );
}
