import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import {
  NOTIFICATION_CHANNELS,
  getNotificationPreferences,
  updateNotificationPreferences,
} from "@/lib/notifications/service";

export const runtime = "nodejs";

// A partial patch: any subset of the channels, each an explicit boolean. An
// unknown key is rejected rather than silently dropped, so a client typo
// (e.g. "emails" instead of "applications") fails loudly instead of quietly
// leaving the user's real preference unchanged.
const patchSchema = z
  .object(
    Object.fromEntries(
      NOTIFICATION_CHANNELS.map((channel) => [channel, z.boolean()])
    ) as Record<(typeof NOTIFICATION_CHANNELS)[number], z.ZodBoolean>
  )
  .partial()
  .refine((value) => Object.keys(value).length > 0, {
    message: "At least one notification channel is required.",
  });

/** The caller's notification preferences, or the product defaults. */
export async function GET() {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getClaims();
  const userId = auth?.claims?.sub;

  if (!userId) {
    return NextResponse.json({ error: "Please sign in again." }, { status: 401 });
  }

  try {
    const preferences = await getNotificationPreferences(supabase, userId);
    return NextResponse.json({ preferences }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    console.error("[ODESSEUS_NOTIFICATIONS] preference lookup failed", error);
    return NextResponse.json(
      { error: "Could not load notification preferences." },
      { status: 500 }
    );
  }
}

/** Applies a partial preference change to the caller's own row. */
export async function PUT(request: Request) {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getClaims();
  const userId = auth?.claims?.sub;

  if (!userId) {
    return NextResponse.json({ error: "Please sign in again." }, { status: 401 });
  }

  let patch: z.infer<typeof patchSchema>;
  try {
    // Accept either a bare channel map or { preferences: ... } so the endpoint
    // is pleasant to call from a form post or a JSON client.
    const body: unknown = await request.json();
    const candidate =
      body && typeof body === "object" && "preferences" in body
        ? (body as { preferences: unknown }).preferences
        : body;
    patch = patchSchema.parse(candidate);
  } catch {
    return NextResponse.json(
      { error: "Those notification settings are not valid." },
      { status: 400 }
    );
  }

  try {
    const preferences = await updateNotificationPreferences(supabase, userId, patch);
    return NextResponse.json({ preferences });
  } catch (error) {
    console.error("[ODESSEUS_NOTIFICATIONS] preference save failed", error);
    return NextResponse.json(
      { error: "Could not save notification preferences." },
      { status: 500 }
    );
  }
}
