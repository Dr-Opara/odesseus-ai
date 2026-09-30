import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import {
  EMPLOYER_NOTIFICATION_CHANNELS,
  getEmployerNotificationPreferences,
  updateEmployerNotificationPreferences,
} from "@/lib/notifications/service";
import { requireOrgAdmin } from "@/lib/employer/service";

export const runtime = "nodejs";

// A partial patch: any subset of the org channels plus the outbound-email
// switch, each an explicit boolean. Unknown keys are rejected so a typo fails
// loudly instead of silently leaving the org's real preference unchanged.
const patchSchema = z
  .object({
    ...(Object.fromEntries(
      EMPLOYER_NOTIFICATION_CHANNELS.map((channel) => [channel, z.boolean()])
    ) as Record<(typeof EMPLOYER_NOTIFICATION_CHANNELS)[number], z.ZodBoolean>),
    email: z.boolean(),
  })
  .partial()
  .refine((value) => Object.keys(value).length > 0, {
    message: "At least one notification channel is required.",
  });

/** The org's notification preferences, or the all-on defaults. Any member may read. */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ orgId: string }> }
) {
  const { orgId } = await params;
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getClaims();
  const userId = auth?.claims?.sub;

  if (!userId) {
    return NextResponse.json({ error: "Please sign in again." }, { status: 401 });
  }

  // A malformed org id is refused here rather than reaching the database,
  // where it surfaces as a 500 from an unhandled query error. Same answer as
  // a well-formed id that names nothing, which is what it is.

  if (!z.string().uuid().safeParse(orgId).success) {
    return NextResponse.json({ error: "That team could not be found." }, { status: 404 });
  }

  const { data: membership } = await supabase
    .from("employer_members")
    .select("role")
    .eq("org_id", orgId)
    .eq("user_id", userId)
    .maybeSingle();

  if (!membership) {
    return NextResponse.json({ error: "Not a member of this organization." }, { status: 403 });
  }

  try {
    const preferences = await getEmployerNotificationPreferences(supabase, orgId);
    return NextResponse.json(
      { preferences },
      { headers: { "Cache-Control": "private, no-store" } }
    );
  } catch (error) {
    console.error("[ODESSEUS_NOTIFICATIONS] employer preference lookup failed", error);
    return NextResponse.json(
      { error: "Could not load notification preferences." },
      { status: 500 }
    );
  }
}

/** Applies a partial preference change. Owner/admin only. */
export async function PUT(
  request: Request,
  { params }: { params: Promise<{ orgId: string }> }
) {
  const { orgId } = await params;
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getClaims();
  const userId = auth?.claims?.sub;

  if (!userId) {
    return NextResponse.json({ error: "Please sign in again." }, { status: 401 });
  }

  // A malformed org id is refused here rather than reaching the database,
  // where it surfaces as a 500 from an unhandled query error. Same answer as
  // a well-formed id that names nothing, which is what it is.

  if (!z.string().uuid().safeParse(orgId).success) {
    return NextResponse.json({ error: "That team could not be found." }, { status: 404 });
  }

  const authz = await requireOrgAdmin(supabase, orgId, userId);
  if (!authz.ok) {
    return NextResponse.json({ error: "Admin access required." }, { status: 403 });
  }

  let patch: z.infer<typeof patchSchema>;
  try {
    // Accept either a bare channel map or { preferences: ... }.
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
    const preferences = await updateEmployerNotificationPreferences(supabase, orgId, patch);
    return NextResponse.json({ preferences });
  } catch (error) {
    console.error("[ODESSEUS_NOTIFICATIONS] employer preference save failed", error);
    return NextResponse.json(
      { error: "Could not save notification preferences." },
      { status: 500 }
    );
  }
}