/**
 * Content hashing for resume files.
 *
 * A resume row stores a `storage_path`, not bytes. Paths are written once
 * (`upsert: false` plus a timestamp component), so a stored file is not
 * overwritten in practice — but "in practice" is not a guarantee, and the
 * applications table is required to preserve the *exact* resume that was
 * submitted. Recording a SHA-256 of the bytes at upload time, and freezing that
 * digest into `applications.resume_snapshot` at finalization, is what turns
 * "we believe this file was not changed" into "the bytes can be checked".
 *
 * Hashing is additive: a resume uploaded before this existed has a null
 * `content_hash`, and a null digest is treated as "unknown", never as a match.
 */

import { createHash } from "node:crypto";

/** Lowercase hex SHA-256 of the given bytes. */
export function hashResumeBytes(bytes: ArrayBuffer | Uint8Array | Buffer): string {
  const view =
    bytes instanceof Uint8Array
      ? bytes
      : new Uint8Array(bytes instanceof ArrayBuffer ? bytes : new ArrayBuffer(0));

  return createHash("sha256").update(view).digest("hex");
}

/**
 * Content hash for an uploaded File, or null when the platform cannot produce
 * one.
 *
 * A null result is never fatal: the upload still succeeds and the resume is
 * still usable, it simply carries no digest to verify later. That is why this
 * never throws.
 */
export async function hashResumeFile(file: File): Promise<string | null> {
  try {
    return hashResumeBytes(await file.arrayBuffer());
  } catch {
    return null;
  }
}
