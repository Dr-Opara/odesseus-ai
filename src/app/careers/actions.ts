"use server";

import { redirect } from "next/navigation";
import { careersService, getCareerRole } from "@/lib/careers/service";
import { careerJobBySlug } from "@/lib/careers/jobs";
import { sendCareerAdminNotice, sendCareerReceipt } from "@/lib/careers/email";

function text(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : "";
}

export async function submitCareerApplication(slug: string, formData: FormData) {
  const job = careerJobBySlug[slug];
  const role = await getCareerRole(slug);
  if (!job || !role || role.status !== "open" || role.remaining <= 0) redirect("/careers?status=closed");

  const fullName = text(formData, "full_name");
  const email = text(formData, "email").toLowerCase();
  const country = text(formData, "country");
  const availability = text(formData, "weekly_availability");
  const why = text(formData, "why_odesseus");
  const answer = text(formData, "screening_answer");
  const resume = formData.get("resume");

  if (!fullName || !email || !country || !availability || !why || !answer || !(resume instanceof File) || !resume.size) {
    redirect(`/careers/${slug}?error=Please%20complete%20all%20required%20fields.`);
  }

  const allowed = new Set(["application/pdf", "application/msword", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"]);
  if (!allowed.has(resume.type) || resume.size > 5 * 1024 * 1024) {
    redirect(`/careers/${slug}?error=Resume%20must%20be%20PDF%20or%20Word%20and%205MB%20or%20smaller.`);
  }

  const service = careersService();
  const ext = resume.name.toLowerCase().endsWith(".pdf") ? "pdf" : resume.name.toLowerCase().endsWith(".docx") ? "docx" : "doc";
  const objectPath = `${slug}/${crypto.randomUUID()}.${ext}`;
  const bytes = Buffer.from(await resume.arrayBuffer());
  const { error: uploadError } = await service.storage.from("career-resumes").upload(objectPath, bytes, { contentType: resume.type, upsert: false });
  if (uploadError) redirect(`/careers/${slug}?error=We%20could%20not%20upload%20your%20resume.%20Please%20try%20again.`);

  const yearsRaw = text(formData, "years_experience");
  const { error } = await service.from("career_applications").insert({
    role_id: role.id,
    full_name: fullName,
    email,
    country,
    time_zone: text(formData, "time_zone") || null,
    linkedin_url: text(formData, "linkedin_url") || null,
    portfolio_url: text(formData, "portfolio_url") || null,
    github_url: text(formData, "github_url") || null,
    years_experience: yearsRaw ? Number(yearsRaw) : null,
    weekly_availability: availability,
    compensation_expectation: text(formData, "compensation_expectation") || null,
    why_odesseus: why,
    screening_answers: { role_question: job.screeningQuestion, answer },
    resume_path: objectPath,
  });

  if (error) {
    await service.storage.from("career-resumes").remove([objectPath]);
    const message = error.code === "23505" ? "You have already applied for this role." : error.message.includes("limit reached") ? "This role has reached its first 100 applications." : "We could not submit your application. Please try again.";
    redirect(`/careers/${slug}?error=${encodeURIComponent(message)}`);
  }

  await Promise.allSettled([sendCareerReceipt(email, job.title), sendCareerAdminNotice(fullName, job.title)]);
  redirect(`/careers/${slug}?status=success`);
}
