"use server";

import { redirect } from "next/navigation";
import { cookies, headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { checkRateLimit } from "@/lib/security/rate-limit";
import { partnerService } from "@/lib/partners/service";

function clean(value: FormDataEntryValue | null) {
  return typeof value === "string" ? value.trim() : "";
}

async function requestIp() {
  const h = await headers();
  const forwarded = h.get("x-forwarded-for");
  return forwarded ? forwarded.split(",")[0].trim() : h.get("x-real-ip") || "unknown";
}

export async function login(formData: FormData) {
  const email = clean(formData.get("email"));
  const password = clean(formData.get("password"));

  if (!email || !password) {
    redirect("/login?error=Enter%20your%20email%20and%20password.");
  }

  const ip = await requestIp();
  const ipLimit = checkRateLimit(`login:ip:${ip}`, 20, 10 * 60 * 1000);
  const emailLimit = checkRateLimit(`login:email:${email.toLowerCase()}`, 8, 10 * 60 * 1000);
  if (!ipLimit.allowed || !emailLimit.allowed) {
    redirect("/login?error=Too%20many%20attempts.%20Please%20wait%20a%20few%20minutes%20and%20try%20again.");
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    const message = error.message?.toLowerCase() || "";
    if (message.includes("email not confirmed") || message.includes("email_not_confirmed")) {
      redirect(`/check-email?email=${encodeURIComponent(email)}&reason=unconfirmed`);
    }
    redirect(`/login?error=${encodeURIComponent(error.message)}`);
  }

  if (data.user?.user_metadata?.account_type === "employer") {
    await supabase.auth.signOut();
    redirect("/login?error=This%20is%20an%20employer%20account.%20Please%20use%20Employer%20Sign%20In.");
  }

  redirect("/dashboard");
}

export async function signup(formData: FormData) {
  const firstName = clean(formData.get("first_name"));
  const lastName = clean(formData.get("last_name"));
  const fullName = clean(formData.get("full_name")) || `${firstName} ${lastName}`.trim();
  const email = clean(formData.get("email"));
  const password = clean(formData.get("password"));

  if (!fullName || !email || password.length < 8) {
    redirect("/signup?error=Complete%20all%20fields%20and%20use%20at%20least%208%20characters.");
  }

  const ip = await requestIp();
  const ipLimit = checkRateLimit(`signup:ip:${ip}`, 8, 60 * 60 * 1000);
  if (!ipLimit.allowed) {
    redirect("/signup?error=Too%20many%20accounts%20created%20recently.%20Please%20try%20again%20later.");
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: {
        full_name: fullName,
        first_name: firstName,
        last_name: lastName,
        account_type: "candidate",
      },
    },
  });

  if (error) {
    redirect(`/signup?error=${encodeURIComponent(error.message)}`);
  }

  if (data.user) {
    const cookieStore = await cookies();
    const visitorId = cookieStore.get("odesseus_ref")?.value;
    if (visitorId) {
      const service = partnerService();
      await service
        .from("partner_referrals")
        .update({ signup_user_id: data.user.id, signup_at: new Date().toISOString() })
        .eq("visitor_id", visitorId)
        .is("signup_user_id", null);
      cookieStore.delete("odesseus_ref");

      // Track partner referral signup
      try {
        const { trackEventServer } = await import("@/lib/analytics/tracking");
        await trackEventServer({
          event: "partner_referral_signup",
          properties: { code: visitorId },
          userId: data.user.id,
        });
      } catch {
        // Analytics failure should not block the response
      }
    }
  }

  if (data.session) {
    await supabase.from("profiles").upsert({
      id: data.user!.id,
      full_name: fullName,
    });

    // Track signup completion
    try {
      const { trackEventServer } = await import("@/lib/analytics/tracking");
      await trackEventServer({
        event: "signup_completed",
        properties: { method: "email" },
        userId: data.user!.id,
      });
    } catch {
      // Analytics failure should not block the response
    }

    redirect("/onboarding");
  }

  redirect(`/check-email?email=${encodeURIComponent(email)}`);
}

export async function resendVerification(formData: FormData) {
  const email = clean(formData.get("email"));

  if (!email) {
    redirect("/check-email?error=Enter%20your%20email%20address.");
  }

  const ip = await requestIp();
  const ipLimit = checkRateLimit(`verify-resend:ip:${ip}`, 8, 60 * 60 * 1000);
  const emailLimit = checkRateLimit(
    `verify-resend:email:${email.toLowerCase()}`,
    3,
    10 * 60 * 1000
  );

  if (!ipLimit.allowed || !emailLimit.allowed) {
    redirect(
      `/check-email?email=${encodeURIComponent(email)}&error=${encodeURIComponent(
        "Please wait a few minutes before requesting another verification email."
      )}`
    );
  }

  const supabase = await createClient();

  // Supabase deliberately avoids revealing whether an email belongs to an
  // existing account. Keep the response generic for the same reason.
  await supabase.auth.resend({
    type: "signup",
    email,
  });

  redirect(
    `/check-email?email=${encodeURIComponent(email)}&resent=1`
  );
}

export async function logout() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}