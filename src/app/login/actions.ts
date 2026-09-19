"use server";

import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { checkRateLimit } from "@/lib/security/rate-limit";

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
  const { error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    redirect(`/login?error=${encodeURIComponent(error.message)}`);
  }

  redirect("/dashboard");
}

export async function signup(formData: FormData) {
  const fullName = clean(formData.get("full_name"));
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
      data: { full_name: fullName },
    },
  });

  if (error) {
    redirect(`/signup?error=${encodeURIComponent(error.message)}`);
  }

  if (data.session) {
    await supabase.from("profiles").upsert({
      id: data.user!.id,
      full_name: fullName,
    });
    redirect("/onboarding");
  }

  redirect("/check-email");
}

export async function logout() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}
