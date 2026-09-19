import { createBrowserClient } from "@supabase/ssr";
import type { Database } from "@/types/database";
import { publicSupabaseUrl, publicSupabasePublishableKey } from "@/lib/supabase/public-config";

export function createClient() {
  return createBrowserClient<Database>(
    publicSupabaseUrl,
    publicSupabasePublishableKey
  );
}
