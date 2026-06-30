#!/usr/bin/env node
// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * OKF v0.1 conformance validator.
 *
 * Rules:
 *   1. Every .md in docs/okf/ (excluding index.md and log.md) must open with --- ... ---
 *   2. The frontmatter must contain a non-empty `type` field
 *   3. index.md must NOT start with --- (it's frontmatter-free per spec)
 *   4. log.md must NOT start with --- (also frontmatter-free per spec)
 *
 * Usage: node scripts/validate-okf.mjs [--dir docs/okf]
 * Exit 0 = conformant; Exit 1 = violations found
 */

import { readdir, readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';

const RESERVED = new Set(['index.md', 'log.md']);
const ROOT = process.argv[2] === '--dir' ? process.argv[3] : 'docs/okf';

async function collectMd(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const e of entries) {
    const full = join(dir, e.name);
    if (e.isDirectory()) files.push(...await collectMd(full));
    else if (e.name.endsWith('.md')) files.push(full);
  }
  return files;
}

function extractType(content) {
  // Match opening YAML fence
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return { hasFrontmatter: false, type: null };
  const fm = match[1];
  const typeMatch = fm.match(/^type\s*:\s*(.+)$/m);
  const type = typeMatch ? typeMatch[1].trim() : null;
  return { hasFrontmatter: true, type };
}

const files = await collectMd(ROOT);
const errors = [];

for (const file of files) {
  const rel = relative(process.cwd(), file);
  const basename = file.split('/').pop();
  const content = await readFile(file, 'utf8');

  if (RESERVED.has(basename)) {
    // Reserved files must NOT have frontmatter
    if (content.trimStart().startsWith('---')) {
      errors.push(`${rel}: reserved file "${basename}" must not have YAML frontmatter`);
    }
    continue;
  }

  const { hasFrontmatter, type } = extractType(content);

  if (!hasFrontmatter) {
    errors.push(`${rel}: missing YAML frontmatter (must open with ---)`);
    continue;
  }
  if (!type) {
    errors.push(`${rel}: frontmatter is missing a non-empty "type" field`);
  }
}

if (errors.length > 0) {
  console.error(`\nOKF conformance check FAILED (${errors.length} violation(s)):\n`);
  for (const e of errors) console.error(`  ✗ ${e}`);
  console.error('\nFix: ensure every non-reserved .md has YAML frontmatter with a non-empty `type` field.');
  console.error('Docs: docs/okf/index.md\n');
  process.exit(1);
}

console.log(`OKF conformance check passed — ${files.length} files validated.`);
