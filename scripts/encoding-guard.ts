#!/usr/bin/env node
/**
 * Repo-wide encoding integrity scan.
 *
 * Extends the country-seed encoding detection (scripts/countries/encoding.ts)
 * to all tracked source files. Fails on any encoding-corruption pattern:
 * - U+FFFD replacement characters (?)
 * - Control characters (C0/C1)
 * - Lone surrogates
 * - Double-encoded UTF-8 (mojibake: Ã/Â prefixes)
 * - CP1252 mojibake tokens (â€…, ï»¿, etc.)
 * - BOM in content
 * - Non-NFC normalization
 *
 * Usage:
 *   node scripts/encoding-guard.ts
 *   node scripts/encoding-guard.ts --fix   (not implemented — we never auto-repair)
 *
 * Exit codes: 0 = clean, 1 = issues found, 2 = I/O error
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  findEncodingCorruption,
  type EncodingIssue,
} from "./countries/encoding.js";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const ROOT = resolve(__dirname, "..", "..");

// File patterns to scan (source code, tests, config, docs)
const INCLUDE_GLOBS = [
  "**/*.ts",
  "**/*.tsx",
  "**/*.js",
  "**/*.jsx",
  "**/*.json",
  "**/*.md",
  "**/*.css",
  "**/*.html",
];

// Directories/files to skip
const EXCLUDE_DIRS = new Set([
  "node_modules",
  ".next",
  ".git",
  "dist",
  "build",
  "coverage",
  "test-results",
  ".turbo",
  ".vercel",
  "supabase", // migrations are SQL, handled separately
  ".swc", // binary wasm plugins
]);

const EXCLUDE_FILES = new Set([
  "package-lock.json",
  "pnpm-lock.yaml",
  "yarn.lock",
  "next-env.d.ts", // auto-generated
]);

// Binary file extensions to skip entirely
const BINARY_EXTS = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".avif",
  ".ico",
  ".svg",
  ".woff",
  ".woff2",
  ".ttf",
  ".eot",
  ".pdf",
  ".zip",
  ".gz",
  ".tar",
  ".wasm",
  ".wasmer-v7",
]);

// File patterns that are test fixtures or contain intentional mojibake for testing
const EXCLUDE_PATTERNS = [
  /\.test\.ts$/,
  /\.test\.tsx$/,
  /\.spec\.ts$/,
  /\.spec\.tsx$/,
  /scripts\/countries\/encoding\.ts$/, // contains test fixtures
  /tests\/unit\/country-seed-encoding\.test\.ts$/, // test fixtures
  /tests\/e2e\/mobile-pricing\.spec\.ts$/, // contains intentional test char
  /docs\/development\/global-identity\.md$/, // intentional mojibake examples
  /scripts\/encoding-guard\.ts$/, // self-reference with comment char
];

function isExcluded(relPath: string): boolean {
  // Normalize to forward slashes for consistent matching
  const normalized = relPath.replace(/\\/g, "/");
  const parts = normalized.split("/");
  for (const part of parts) {
    if (EXCLUDE_DIRS.has(part)) return true;
  }
  const fileName = parts[parts.length - 1];
  if (EXCLUDE_FILES.has(fileName)) return true;
  const ext = fileName.slice(fileName.lastIndexOf("."));
  if (BINARY_EXTS.has(ext)) return true;
  // Check pattern exclusions
  for (const pattern of EXCLUDE_PATTERNS) {
    if (pattern.test(normalized)) return true;
  }
  return false;
}

function walk(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    const rel = relative(ROOT, full);
    if (isExcluded(rel)) continue;
    if (entry.isDirectory()) {
      walk(full, acc);
    } else if (entry.isFile()) {
      acc.push(full);
    }
  }
  return acc;
}

function scanFile(filePath: string): (EncodingIssue & { file: string })[] {
  try {
    const content = readFileSync(filePath, "utf-8");
    const issues = findEncodingCorruption(content);
    if (issues.length > 0) {
      return issues.map((issue) => ({ ...issue, file: relative(ROOT, filePath).replace(/\\/g, "/") }));
    }
  } catch (e) {
    if (e instanceof Error && e.message.includes("ENOENT")) {
      // File deleted during scan — ignore
    } else {
      console.warn(`[WARN] Could not read ${relative(ROOT, filePath).replace(/\\/g, "/")}: ${e}`);
    }
  }
  return [];
}

async function main() {
  const args = process.argv.slice(2);
  const fixMode = args.includes("--fix"); // reserved, not implemented

  console.log(`[encoding-guard] Scanning repository at ${ROOT}...`);

  const files = walk(ROOT);
  console.log(`[encoding-guard] ${files.length} files to scan`);

  let totalIssues = 0;
  const byKind = new Map<string, number>();

  for (const file of files) {
    const issues = scanFile(file);
    if (issues.length > 0) {
      totalIssues += issues.length;
      for (const issue of issues) {
        byKind.set(issue.kind, (byKind.get(issue.kind) || 0) + 1);
        console.error(
          `[FAIL] ${issue.file}:${issue.index} ${issue.kind} — ${issue.message}`,
        );
      }
    }
  }

  if (totalIssues > 0) {
    console.error(
      `\n[encoding-guard] Found ${totalIssues} encoding issue(s) in ${files.length} files:`,
    );
    for (const [kind, count] of byKind.entries()) {
      console.error(`  ${kind}: ${count}`);
    }
    console.error(
      "\n[encoding-guard] No files were modified. Fix the source files manually.",
    );
    process.exit(1);
  }

  console.log(`\n[encoding-guard] All ${files.length} files clean.`);
  process.exit(0);
}

main().catch((err) => {
  console.error("[encoding-guard] Fatal error:", err);
  process.exit(2);
});