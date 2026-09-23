"use server";

import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { checkRateLimit } from "@/lib/security/rate-limit";

const PERSONAL_EMAIL_DOMAINS = new Set([
  "gmail.com","googlemail.com","yahoo.com","yahoo.co.uk","ymail.com",
  "outlook.com","hotmail.com","live.com","msn.com",
  "icloud.com","me.com","mac.com",
  "aol.com","proton.me","protonmail.com",
  "gmx.com","gmx.net","mail.com","yandex.com","yandex.ru",
  "fastmail.com","hey.com","zoho.com"
]);

function clean(value: FormDataEntryValue | null) {
  return typeof value === "string" ? value.trim() : "";
}

function companyEmail(email: string) {
  const parts = email.toLowerCase().split("@");
  if (parts.length !== 2 || !parts[0] || !parts[1]) return false;
  return !PERSONAL_EMAIL_DOMAINS.has(parts[1]);
}

async function requestIp() {
  const h = await headers();
  const forwarded = h.get("x-forwarded-for");
  return forwarded ? forwarded.split(",")[0].trim() : h.get("x-real-ip") || "unknown";
}

export async function employerSignup(formData: FormData) {
  const companyName = clean(formData.get("company_name"));
  const email = clean(formData.get("email")).toLowerCase();
  const password = clean(formData.get("password"));

  if (!companyName || !email || password.length < 8) {
    redirect("/employers/signup?error=Complete%20all%20fields%20and%20use%20at%20least%208%20characters.");
  }

  if (!companyEmail(email)) {
    redirect("/employers/signup?error=Please%20use%20your%20company%20email%20address.%20Personal%20email%20domains%20are%20not%20accepted.");
  }

  const ip = await requestIp();
  const limit = checkRateLimit(`employer-signup:ip:${ip}`, 8, 60 * 60 * 1000);
  if (!limit.allowed) {
    redirect("/employers/signup?error=Too%20many%20accounts%20created%20recently.%20Please%20try%20again%20later.");
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: {
        account_type: "employer",
        company_name: companyName,
        company_email_domain: email.split("@")[1],
      },
      emailRedirectTo: undefined,
    },
  });

  if (error) redirect(`/employers/signup?error=${encodeURIComponent(error.message)}`);

  if (data.session) redirect("/employers/dashboard");
  redirect("/check-email");
}

export async function employerLogin(formData: FormData) {
  const email = clean(formData.get("email")).toLowerCase();
  const password = clean(formData.get("password"));

  if (!email || !password) {
    redirect("/employers/login?error=Enter%20your%20company%20email%20and%20password.");
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) redirect(`/employers/login?error=${encodeURIComponent(error.message)}`);

  if (data.user?.user_metadata?.account_type !== "employer") {
    await supabase.auth.signOut();
    redirect("/employers/login?error=This%20account%20is%20not%20registered%20as%20an%20employer.");
  }

  redirect("/employers/dashboard");
}
