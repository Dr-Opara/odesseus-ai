-- Private storage for career application resumes. Additive migration.
--
-- Phase 14B added the careers schema (career_job_openings /
-- career_applications) with a `resume_url` column, but no bucket, so the
-- column could only ever hold a string an applicant supplied. An applicant
-- chose that string, and it was later handed to an admin to open. This
-- migration gives the column a real meaning: the path of an object the
-- server itself uploaded.
--
-- Deliberately no storage.objects policies. The resumes bucket is private and
-- reachable only through the caller's own rows; a second policy family here
-- would also trip the RLS audit assertion that storage.objects carries exactly
-- the four resume_files_* policies. Careers resumes are read by exactly one
-- path — an admin capability check followed by a short-lived service-role
-- signed URL — and an applicant never receives one for their own upload, so
-- there is nothing for a policy to grant.
--
-- 5 MB and three document types, matching the candidate resumes bucket. A
-- resume is a document, not an arbitrary file: accepting executables here
-- would put uploaded binaries in the same trust domain as the hiring pipeline.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'career-resumes',
  'career-resumes',
  false,
  5242880,
  array[
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  ]::text[]
)
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types,
      updated_at = now();
