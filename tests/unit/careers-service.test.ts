import { describe, expect, it } from "vitest";
import {
  careerResumePath,
  isReviewableApplicationStatus,
  REVIEWABLE_APPLICATION_STATUSES,
  usableResumePath,
} from "@/lib/careers/service";

const APP_ID = "33333333-3333-4333-8333-333333333333";

describe("careerResumePath", () => {
  it("derives the extension from a fixed whitelist, never the filename", () => {
    // The applicant controls the filename entirely. A path built from it is a
    // path traversal, a second extension, or an object in someone else's
    // directory — the same bug class as an id taken from a query parameter.
    expect(careerResumePath({ applicationId: APP_ID, mimeType: "application/pdf" })).toBe(
      `${APP_ID}/resume.pdf`
    );
    expect(
      careerResumePath({
        applicationId: APP_ID,
        mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      })
    ).toBe(`${APP_ID}/resume.docx`);
    expect(careerResumePath({ applicationId: APP_ID, mimeType: "application/msword" })).toBe(
      `${APP_ID}/resume.doc`
    );
  });

  it("namespaces by application id", () => {
    const path = careerResumePath({ applicationId: APP_ID, mimeType: "application/pdf" });
    expect(path.startsWith(`${APP_ID}/`)).toBe(true);
    // Exactly one segment boundary: no caller-supplied depth.
    expect(path.split("/")).toHaveLength(2);
  });

  it("never emits an executable extension, whatever the type claims", () => {
    for (const mimeType of [
      "application/x-msdownload",
      "image/svg+xml",
      "text/html",
      "application/javascript",
    ]) {
      const path = careerResumePath({ applicationId: APP_ID, mimeType });
      expect(path.endsWith(".doc")).toBe(true);
    }
  });
});

describe("usableResumePath", () => {
  it("refuses the two placeholders the submission path can leave behind", () => {
    // "pending" and "upload-failed" are what the row carries when the upload did
    // not produce a document. Handing either to createSignedUrl would ask storage
    // for an object that does not exist, and reporting that as a 500 would point
    // an admin at the wrong failure.
    expect(usableResumePath("pending")).toBeNull();
    expect(usableResumePath("upload-failed")).toBeNull();
  });

  it("refuses an empty path", () => {
    expect(usableResumePath(null)).toBeNull();
    expect(usableResumePath(undefined)).toBeNull();
    expect(usableResumePath("")).toBeNull();
  });

  it("passes a real object path through", () => {
    expect(usableResumePath(`${APP_ID}/resume.pdf`)).toBe(`${APP_ID}/resume.pdf`);
  });
});

describe("isReviewableApplicationStatus", () => {
  it("refuses the two states a reviewer must not set", () => {
    // "submitted" is the initial state, and pushing a row back into it would
    // undo the fact that a human picked it up. "withdrawn" is the applicant's
    // decision, not a reviewer's.
    expect(isReviewableApplicationStatus("submitted")).toBe(false);
    expect(isReviewableApplicationStatus("withdrawn")).toBe(false);
  });

  it("accepts every published reviewable status", () => {
    for (const status of REVIEWABLE_APPLICATION_STATUSES) {
      expect(isReviewableApplicationStatus(status)).toBe(true);
    }
  });

  it("refuses non-strings and unknown strings", () => {
    expect(isReviewableApplicationStatus("hired ")).toBe(false);
    expect(isReviewableApplicationStatus("HIRED")).toBe(false);
    expect(isReviewableApplicationStatus(null)).toBe(false);
    expect(isReviewableApplicationStatus(3)).toBe(false);
    expect(isReviewableApplicationStatus({})).toBe(false);
  });
});
