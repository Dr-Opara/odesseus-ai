/**
 * Partner Program email delivery.
 *
 * A thin wrapper over the shared transport in `@/lib/email/send`, kept so the
 * existing Partner Program call sites and their log prefix are unchanged. The
 * Partner Program and employer invitations are the only two senders; a third
 * should call the shared transport directly rather than adding a wrapper here.
 */
import { sendEmail, type EmailInput, type EmailResult } from "@/lib/email/send";

export type PartnerEmailInput = EmailInput;

export async function sendPartnerEmail(
  input: PartnerEmailInput
): Promise<EmailResult> {
  return sendEmail(input, "[ODESSEUS_PARTNERS]");
}
