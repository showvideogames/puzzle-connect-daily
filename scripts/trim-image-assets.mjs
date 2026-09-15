#!/usr/bin/env node
// Trims transparent outer padding from the PNG assets used by the app's
// custom-emoji feature (src/lib/customEmoji.ts / CustomEmojiManager.tsx),
// which lives entirely in Supabase Storage — there is no local raw/processed
// asset folder in this repo to begin with, so this script downloads each
// asset, trims it with Sharp, and re-uploads it to the exact same Storage
// path. Nothing local is duplicated or left behind.
//
// There is currently no separate "hints" bucket/path: the hint icons added
// alongside the custom result grid (ResultGrid.tsx) are inline SVG, not
// raster assets, so there's nothing to trim for them today. If a dedicated
// hint-image bucket is ever added, list it in BUCKETS below.
//
// Usage:
//   npm run trim:assets                            process every PNG, upload changes
//   npm run trim:assets -- --dry-run               process + report dimensions, upload nothing
//   npm run trim:assets -- --file NAME             process a single asset only (e.g.
//                                                   "smile" or "smile.png"); useful for
//                                                   validating the workflow before a full run
//   npm run trim:assets -- --dry-run --file NAME   combine both
// (npm needs the extra "--" to forward flags to the script instead of eating them itself.)
//
// Requires two environment variables (never commit these, never prefix with
// VITE_ — that would ship the service-role key to the browser bundle):
//   SUPABASE_URL
//   SUPABASE_SERVICE_ROLE_KEY
// Put them in a local, gitignored .env file (this script loads one if
// present) or export them in your shell before running.

import { createClient } from "@supabase/supabase-js";
import sharp from "sharp";
import { existsSync, readFileSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

// ── Configuration ──────────────────────────────────────────────────────────

// Transparent margin (px) re-added on every side after trimming.
const PADDING_PX = 4;

// Storage buckets to scan for PNGs. Add a bucket/prefix here if a dedicated
// hint-image bucket is ever introduced — see the file header comment.
const BUCKETS = ["custom-emoji"];

// If trimming+re-padding wouldn't change either dimension by more than this,
// skip re-uploading — the asset is already tightly cropped.
const UNCHANGED_TOLERANCE_PX = 1;

// ── Tiny .env loader (no extra dependency) ─────────────────────────────────

function loadDotEnv(file = ".env") {
  if (!existsSync(file)) return;
  for (const rawLine of readFileSync(file, "utf8").split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = value;
  }
}
loadDotEnv();

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error(
    "Missing SUPABASE_URL and/or SUPABASE_SERVICE_ROLE_KEY.\n" +
    "Set them in a local .env file (gitignored, never commit the key) or export them in your shell."
  );
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

// ── CLI args ────────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const args = { dryRun: false, file: null };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--dry-run") {
      args.dryRun = true;
    } else if (arg === "--file") {
      args.file = argv[++i];
    } else if (arg.startsWith("--file=")) {
      args.file = arg.slice("--file=".length);
    }
  }
  return args;
}

const { dryRun, file: fileArg } = parseArgs(process.argv.slice(2));

// ── Storage helpers ─────────────────────────────────────────────────────────

// Supabase Storage's list() returns folders as entries with id === null;
// files have a real id. Recurse into folders so nested paths are covered
// even though the custom-emoji bucket is currently flat.
async function listPngPaths(bucket, prefix = "") {
  const { data, error } = await supabase.storage.from(bucket).list(prefix, { limit: 1000 });
  if (error) throw new Error(`Failed to list ${bucket}/${prefix}: ${error.message}`);

  const paths = [];
  for (const entry of data ?? []) {
    const fullPath = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.id === null) {
      paths.push(...(await listPngPaths(bucket, fullPath)));
    } else if (entry.name.toLowerCase().endsWith(".png")) {
      paths.push(fullPath);
    }
  }
  return paths;
}

async function processAsset(bucket, filePath, { dryRun = false } = {}) {
  const { data: blob, error: downloadError } = await supabase.storage.from(bucket).download(filePath);
  if (downloadError) {
    console.error(`  [FAILED download] ${bucket}/${filePath}: ${downloadError.message}`);
    return;
  }
  const inputBuffer = Buffer.from(await blob.arrayBuffer());
  const { width: originalW, height: originalH } = await sharp(inputBuffer).metadata();

  // Trim fully-transparent outer padding, then add back a small, consistent
  // margin — preserves aspect ratio and transparency, never stretches.
  const trimmedBuffer = await sharp(inputBuffer)
    .trim({ background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .extend({
      top: PADDING_PX,
      bottom: PADDING_PX,
      left: PADDING_PX,
      right: PADDING_PX,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .png()
    .toBuffer();

  const { width: newW, height: newH } = await sharp(trimmedBuffer).metadata();

  if (Math.abs(newW - originalW) <= UNCHANGED_TOLERANCE_PX && Math.abs(newH - originalH) <= UNCHANGED_TOLERANCE_PX) {
    console.log(`  ${bucket}/${filePath}: already tight (${originalW}x${originalH}) — skipped`);
    return;
  }

  if (dryRun) {
    console.log(`  [DRY RUN] ${bucket}/${filePath}: ${originalW}x${originalH} -> ${newW}x${newH} (would update, not uploaded)`);
    return;
  }

  // Write the processed image to a temp file and re-decode it as a
  // correctness check BEFORE touching the remote asset — the upload below
  // only runs once this has succeeded, and upload() is a single atomic PUT,
  // so the original object in Storage is never partially overwritten.
  const tmpDir = mkdtempSync(path.join(tmpdir(), "trim-assets-"));
  const tmpFile = path.join(tmpDir, path.basename(filePath));
  try {
    writeFileSync(tmpFile, trimmedBuffer);
    await sharp(tmpFile).metadata(); // throws if the written file isn't a valid PNG

    const { error: uploadError } = await supabase.storage
      .from(bucket)
      .upload(filePath, trimmedBuffer, { contentType: "image/png", upsert: true });

    if (uploadError) {
      console.error(`  [FAILED upload] ${bucket}/${filePath}: ${uploadError.message}`);
      return;
    }

    console.log(`  ${filePath}: ${originalW}x${originalH} -> ${newW}x${newH}`);
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
}

async function main() {
  console.log(
    `Trimming transparent padding from custom PNG assets (padding: ${PADDING_PX}px)` +
    (dryRun ? " [DRY RUN — nothing will be uploaded]" : "") + "\n"
  );

  if (fileArg) {
    // Single-file mode: accept "name", "name.png", or "bucket/name.png".
    let bucket = BUCKETS[0];
    let filePath = fileArg;
    const slash = fileArg.indexOf("/");
    if (slash !== -1 && BUCKETS.includes(fileArg.slice(0, slash))) {
      bucket = fileArg.slice(0, slash);
      filePath = fileArg.slice(slash + 1);
    }
    if (!filePath.toLowerCase().endsWith(".png")) filePath += ".png";

    console.log(`Bucket: ${bucket} (single file: ${filePath})`);
    try {
      await processAsset(bucket, filePath, { dryRun });
    } catch (err) {
      console.error(`  [FAILED] ${bucket}/${filePath}:`, err.message ?? err);
    }
    console.log("\nDone.");
    return;
  }

  for (const bucket of BUCKETS) {
    console.log(`Bucket: ${bucket}`);
    const files = await listPngPaths(bucket);
    if (files.length === 0) {
      console.log("  (no PNG files found)\n");
      continue;
    }
    for (const filePath of files) {
      try {
        await processAsset(bucket, filePath, { dryRun });
      } catch (err) {
        // Isolate failures per-file (corrupt PNG, transient network error,
        // etc.) so one bad asset doesn't abort the rest of the batch.
        console.error(`  [FAILED] ${bucket}/${filePath}:`, err.message ?? err);
      }
    }
    console.log("");
  }

  console.log("Done.");
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
