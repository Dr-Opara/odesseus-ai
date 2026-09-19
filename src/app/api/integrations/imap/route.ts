import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { fetchRecentImapMessages } from "@/lib/integrations/imap";
import { defaultImapSettings } from "@/lib/integrations/providers";

const schema = z.object({
  provider: z.enum(["icloud", "imap"]),
  email: z.string().email(),
  secret: z.string().min(1).max(500),
  host: z.string().trim().max(255).optional().default(""),
  port: z.number().int().min(1).max(65535).optional().default(993),
});

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getClaims();
  const userId = auth?.claims?.sub;

  if (!userId) {
    return NextResponse.json({ error: "Please sign in again." }, { status: 401 });
  }

  let input: z.infer<typeof schema>;
  try {
    input = schema.parse(await request.json());
  } catch {
    return NextResponse.json({ error: "Check the email connection details." }, { status: 400 });
  }

  const defaults = defaultImapSettings(input.provider);
  const host = input.host || defaults?.host;

  if (!host) {
    return NextResponse.json({ error: "IMAP host is required." }, { status: 400 });
  }

  try {
    await fetchRecentImapMessages(
      {
        email: input.email,
        host,
        port: input.port || defaults?.port || 993,
        pass: input.secret,
      },
      new Date(Date.now() - 86400000)
    );

    const service = createServiceClient();

    const { data: secretId, error: secretError } = await service.rpc(
      "odysseus_store_integration_secret",
      {
        p_user_id: userId,
        p_secret: input.secret,
        p_name: `${input.provider}:${input.email}`,
      }
    );

    if (secretError || !secretId) {
      throw new Error("Odysseus could not secure the mail credential.");
    }

    const { error } = await service
      .from("integration_accounts")
      .upsert(
        {
          user_id: userId,
          service_type: "email",
          provider: input.provider,
          account_email: input.email,
          auth_method: "imap_secret",
          vault_secret_id: secretId,
          imap_host: host,
          imap_port: input.port || defaults?.port || 993,
          status: "connected",
          connected_at: new Date().toISOString(),
          last_error: null,
          updated_at: new Date().toISOString(),
        },
        {
          onConflict: "user_id,service_type,provider,account_email",
        }
      );

    if (error) throw new Error(error.message);

    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Odysseus could not connect this mailbox.",
      },
      { status: 400 }
    );
  }
}
