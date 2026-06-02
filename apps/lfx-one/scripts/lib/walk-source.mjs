// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, posix, relative, sep } from 'node:path';

import matter from 'gray-matter';

/**
 * @typedef {Object} SourceRecord
 * @property {string} sourcePath  Path relative to repo root, e.g. 'docs/user/meetings/schedule-meeting/index.md'.
 * @property {string} slug        Article slug, e.g. 'meetings/schedule-meeting' (empty string for the root landing).
 * @property {Record<string, unknown>} frontMatter  Parsed front-matter payload (empty object on parse failure).
 * @property {string} body        Markdown body with front-matter stripped.
 * @property {string} mtimeIso    File mtime as ISO-8601 yyyy-mm-dd; used as fallback for `last_updated`.
 * @property {number} mtimeMs     File mtime as epoch milliseconds; used to derive a deterministic manifest `generatedAt`.
 * @property {string[]} warnings  Per-file warnings (e.g. malformed front-matter).
 */

/**
 * Recursively collects all `index.md` files under a docs source directory and
 * returns one `SourceRecord` per file. Skips the VitePress-only root
 * `docs/user/index.md` (research R8) — the build pipeline produces a
 * synthesized root landing instead, so the user-authored stub is ignored.
 *
 * Front-matter is parsed with `gray-matter`; per FR-028, malformed YAML MUST
 * NOT abort the build. Each record carries a `warnings` array that the
 * orchestrator merges into the build log.
 *
 * @param {Object} options
 * @param {string} options.sourceRoot   Directory to walk (e.g. `<repoRoot>/docs/user`).
 * @param {string} options.repoRoot     Repository root, used to compute repo-relative `sourcePath`.
 * @returns {SourceRecord[]} Records sorted by slug for deterministic build output (research R17).
 */
export function walkDocsSource({ sourceRoot, repoRoot }) {
  /** @type {SourceRecord[]} */
  const records = [];
  walk(sourceRoot, sourceRoot, repoRoot, records);
  // Sort by slug for byte-identical output across runs.
  records.sort((a, b) => (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0));
  return records;
}

/**
 * Recursively visits a directory, appending records for every `index.md` it finds.
 *
 * @param {string} dir
 * @param {string} sourceRoot
 * @param {string} repoRoot
 * @param {SourceRecord[]} records
 */
function walk(dir, sourceRoot, repoRoot, records) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const absPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(absPath, sourceRoot, repoRoot, records);
      continue;
    }
    if (!entry.isFile() || entry.name !== 'index.md') {
      continue;
    }

    const repoRelative = toPosix(relative(repoRoot, absPath));
    // Skip the VitePress-only root index — research R8.
    if (repoRelative === toPosix(relative(repoRoot, join(sourceRoot, 'index.md')))) {
      continue;
    }

    const record = parseRecord({ absPath, sourceRoot, repoRoot });
    records.push(record);
  }
}

/**
 * @param {Object} args
 * @param {string} args.absPath
 * @param {string} args.sourceRoot
 * @param {string} args.repoRoot
 * @returns {SourceRecord}
 */
function parseRecord({ absPath, sourceRoot, repoRoot }) {
  /** @type {string[]} */
  const warnings = [];
  const sourcePath = toPosix(relative(repoRoot, absPath));

  // Slug: take the path under sourceRoot, drop trailing /index.md.
  const slugRel = toPosix(relative(sourceRoot, absPath));
  const slug = slugRel === 'index.md' ? '' : slugRel.replace(/\/index\.md$/, '').replace(/\.md$/, '');

  let frontMatter = /** @type {Record<string, unknown>} */ ({});
  let body = '';

  const raw = readFileSync(absPath, 'utf8');
  try {
    const parsed = matter(raw);
    frontMatter = /** @type {Record<string, unknown>} */ (parsed.data ?? {});
    body = parsed.content ?? '';
  } catch (err) {
    // FR-028: malformed front-matter MUST NOT fail the build — fall back to no
    // front-matter and the original body.
    warnings.push(`malformed front-matter in ${sourcePath}: ${err instanceof Error ? err.message : String(err)}`);
    body = raw;
  }

  const mtime = statSync(absPath).mtime;
  const mtimeIso = isoDate(mtime);
  const mtimeMs = mtime.getTime();

  return { sourcePath, slug, frontMatter, body, mtimeIso, mtimeMs, warnings };
}

/** @param {Date} d */
function isoDate(d) {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * Normalizes path separators to POSIX so slugs and sourcePaths are stable
 * across Linux / macOS / Windows builds.
 *
 * @param {string} p
 */
function toPosix(p) {
  return p.split(sep).join(posix.sep);
}
