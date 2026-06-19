#!/usr/bin/env node
// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * Phase-1 newsletter block-manifest generator (LFXV2-2381).
 *
 * Parses the declarative newsletter templates (the hard-coded template repo) and
 * emits a NewsletterTemplateManifest JSON asset consumed by the block-composer
 * editor. Under the unified model, `blocks/` AND `bricks/` are ONE block
 * namespace — the filename (without extension) is the `block_type`.
 *
 * Each template begins with an HTML comment of the form:
 *   <!-- SCHEMA: { ...JSON... } -->
 * The JSON is parsed into the manifest entry's `schema`. A block is a container
 * (`is_container: true`) when its schema declares a field of type `slot`.
 *
 * Usage:
 *   node scripts/build-newsletter-manifest.mjs [--template-repo <path>]
 *
 * Defaults to the local clone at ../../../gatewaze/newsletter-aaif-user-community
 * relative to the app root. Pass --template-repo to override.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const APP_ROOT = resolve(SCRIPT_DIR, '..'); // apps/lfx-one

// The Phase-1 template repo lives as a sibling checkout under the gatewaze org
// clone. Resolved from the GATEWAZE_TEMPLATE_REPO env var, then a small set of
// likely sibling locations, then --template-repo overrides everything.
const DEFAULT_TEMPLATE_CANDIDATES = [
  process.env.GATEWAZE_TEMPLATE_REPO,
  resolve(APP_ROOT, '..', '..', '..', 'gatewaze', 'newsletter-aaif-user-community'),
  resolve(APP_ROOT, '..', '..', '..', '..', 'gatewaze', 'newsletter-aaif-user-community'),
].filter(Boolean);
const OUTPUT_PATH = join(APP_ROOT, 'public', 'assets', 'newsletter-block-manifest.json');

// The two template directories that make up the single block namespace.
const BLOCK_DIRS = ['blocks', 'bricks'];
const WRAPPER_KEY = 'default';

/** Parse `--template-repo <path>` from argv, falling back to the default clone. */
function parseTemplateRepo(argv) {
  const idx = argv.indexOf('--template-repo');
  if (idx !== -1 && argv[idx + 1]) {
    return resolve(argv[idx + 1]);
  }
  return DEFAULT_TEMPLATE_CANDIDATES.find((candidate) => existsSync(candidate)) ?? DEFAULT_TEMPLATE_CANDIDATES[0];
}

/** Humanize a snake_case filename into a Title Case label. */
function humanize(blockType) {
  return blockType
    .split('_')
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

/** Extract the JSON from a leading `<!-- SCHEMA: {...} -->` comment. */
function extractSchema(html, filePath) {
  const match = html.match(/<!--\s*SCHEMA:\s*([\s\S]*?)-->/);
  if (!match) {
    throw new Error(`No SCHEMA comment found in ${filePath}`);
  }
  const raw = match[1].trim();
  try {
    return JSON.parse(raw);
  } catch (err) {
    throw new Error(`Invalid SCHEMA JSON in ${filePath}: ${err.message}`);
  }
}

/** A block is a container when any top-level field declares `type: "slot"`. */
function hasSlotField(schema) {
  return Object.values(schema).some((field) => field && typeof field === 'object' && field.type === 'slot');
}

/** Best-effort provenance: the template repo's git remote + pinned commit. */
function resolveSource(templateRepo) {
  const gitDir = join(templateRepo, '.git');
  if (!existsSync(gitDir)) {
    return undefined;
  }
  try {
    const repo = execFileSync('git', ['-C', templateRepo, 'remote', 'get-url', 'origin'], { encoding: 'utf8' }).trim();
    const commit = execFileSync('git', ['-C', templateRepo, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
    return { repo, commit };
  } catch {
    return undefined;
  }
}

/** Read one block directory into manifest entries. */
function readBlockDir(templateRepo, dir) {
  const dirPath = join(templateRepo, dir);
  if (!existsSync(dirPath)) {
    return [];
  }
  return readdirSync(dirPath)
    .filter((name) => extname(name) === '.html')
    .map((name) => {
      const filePath = join(dirPath, name);
      const html = readFileSync(filePath, 'utf8');
      const schema = extractSchema(html, filePath);
      const blockType = basename(name, '.html');
      const entry = {
        block_type: blockType,
        label: humanize(blockType),
        category: 'block',
        schema,
      };
      if (hasSlotField(schema)) {
        entry.is_container = true;
      }
      return entry;
    });
}

function main() {
  const templateRepo = parseTemplateRepo(process.argv.slice(2));
  if (!existsSync(templateRepo)) {
    console.error(`Template repo not found: ${templateRepo}`);
    console.error('Pass --template-repo <path> to point at the newsletter template clone.');
    process.exit(1);
  }

  const blocks = BLOCK_DIRS.flatMap((dir) => readBlockDir(templateRepo, dir))
    // Deterministic order so the committed asset diffs cleanly across runs.
    .sort((a, b) => a.block_type.localeCompare(b.block_type));

  if (blocks.length === 0) {
    console.error(`No block templates found under ${BLOCK_DIRS.join(', ')} in ${templateRepo}`);
    process.exit(1);
  }

  const manifest = {
    wrapper_key: WRAPPER_KEY,
    blocks,
  };
  const source = resolveSource(templateRepo);
  if (source) {
    manifest.source = source;
  }

  mkdirSync(dirname(OUTPUT_PATH), { recursive: true });
  writeFileSync(OUTPUT_PATH, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');

  const containerCount = blocks.filter((b) => b.is_container).length;
  console.log(`Wrote ${blocks.length} block(s) (${containerCount} container) to ${OUTPUT_PATH}`);
  if (source) {
    console.log(`Source: ${source.repo} @ ${source.commit}`);
  }
}

main();
