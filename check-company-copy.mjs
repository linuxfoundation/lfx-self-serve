#!/usr/bin/env node
// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// Company Lens terminology guard (#5061, epic #5060).
//
// Fails when USER-FACING copy says "organization" / "organisation" / "organizational" (any case) or
// "Org Lens". "Company" is the platform's word for every entity. The glossary lives in
// .claude/rules/copy-terminology.md.
//
// Allowlist-driven: check-company-copy.allowlist.txt records how many violations each file has today
// ("<count><TAB><path>"). A file may never exceed its allowed count, and a file that is not listed
// may have none, so the check passes on main and blocks only NEW violations. Stories that fix copy
// lower the counts with `node check-company-copy.mjs --update` (stale entries only warn).
//
// What is scanned (pragmatic, not a proof that no user-visible string slips through):
//   - Angular templates (.html) under apps/lfx-one/src, including email/PDF templates: text nodes,
//     user-visible attributes (title, alt, label, placeholder, aria-*, ...), and quoted strings inside
//     {{ }} / [bound] attribute expressions / control-flow heads. Bare identifiers are ignored.
//   - .ts files under apps/lfx-one/src and packages/shared/src: string literals that are the value of a
//     user-facing key (title, label, header, placeholder, ariaLabel, tooltip, description, heading,
//     subtitle, message, text, summary, name, aria-label ...) when the literal sits on a single line.
//   - docs/user/**/*.md.
// Always allowed: identifiers, comments, API field names, *.spec.ts, e2e/, stories, tool names.
// Escape hatch for a legitimate hit: put `company-copy-ignore` on the same or the previous line.

import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const allowlistPath = join(root, 'check-company-copy.allowlist.txt');
const FORBIDDEN = /organi[sz]ation|\borg lens\b/i;
const IGNORE = 'company-copy-ignore';
const KEYS = 'title|label|header|placeholder|ariaLabel|aria-label|tooltip|description|heading|subtitle|message|text|summary|name|alt|emptyMessage|helpText';

const tracked = execFileSync('git', ['ls-files', '-z'], { cwd: root, maxBuffer: 1 << 28 })
  .toString()
  .split('\0')
  .filter(Boolean);

const isSpec = (f) => /\.(spec|stories|test)\.ts$/.test(f) || /(^|\/)e2e\//.test(f) || /(^|\/)node_modules\//.test(f);
const inScope = (f) =>
  (/^apps\/lfx-one\/src\/.*\.html$/.test(f) && !isSpec(f)) ||
  (/^(apps\/lfx-one\/src|packages\/shared\/src)\/.*\.ts$/.test(f) && !isSpec(f)) ||
  (/^docs\/user\/.*\.md$/.test(f));

// Replace a span with spaces, keeping newlines so line numbers survive.
const blank = (s) => s.replace(/[^\n]/g, ' ');

function quotedStrings(expr) {
  return [...expr.matchAll(/'([^'\n]*)'|"([^"\n]*)"|`([^`]*)`/g)].map((m) => m[1] ?? m[2] ?? m[3] ?? '');
}

/** Returns the user-facing candidate text for each line number: Map<line, string[]>. */
function htmlCandidates(src) {
  const out = [];
  const lineOf = (idx) => src.slice(0, idx).split('\n').length;
  const push = (idx, text) => text && out.push([lineOf(idx), text]);
  let work = src.replace(/<!--[\s\S]*?-->/g, blank);
  // Control-flow heads: only quoted strings matter.
  work = work.replace(/@(?:if|else if|for|switch|case)\s*\(([^)]*)\)/g, (m, e, off) => {
    quotedStrings(e).forEach((s) => push(off, s));
    return blank(m);
  });
  // Tags: inspect attributes, then drop the tag.
  work = work.replace(/<\/?[a-zA-Z][^>]*>/g, (tag, off) => {
    for (const a of tag.matchAll(/([\[\(\*]?[\w.:@-]+[\]\)]?)\s*=\s*("([^"]*)"|'([^']*)')/g)) {
      const name = a[1];
      const val = a[3] ?? a[4] ?? '';
      const bound = /^[\[\(\*]/.test(name);
      const base = name.replace(/^\[(attr\.)?|\]$/g, '');
      const visible = /^(title|alt|label|header|placeholder|tooltip|text|description|heading|subtitle|message|summary|aria-.*|ariaLabel|pTooltip|value|emptyMessage|helpText)$/i.test(base);
      if (bound) {
        if (visible || name.startsWith('[')) quotedStrings(val).forEach((s) => push(off, s));
      } else if (visible) {
        // plain attribute may contain {{ }} interpolation
        push(off, val.replace(/\{\{[\s\S]*?\}\}/g, (e) => (quotedStrings(e).join(' '))));
      }
    }
    return blank(tag);
  });
  // Interpolations: quoted strings only; remaining text nodes are copy.
  work = work.replace(/\{\{([\s\S]*?)\}\}/g, (m, e, off) => {
    quotedStrings(e).forEach((s) => push(off, s));
    return blank(m);
  });
  work.split('\n').forEach((l, i) => l.trim() && out.push([i + 1, l]));
  return out;
}

function tsCandidates(src) {
  const out = [];
  const stripped = src.replace(/\/\*[\s\S]*?\*\//g, blank).replace(/(^|[^:'"`\\])\/\/[^\n]*/g, (m, p) => p + blank(m.slice(p.length)));
  const re = new RegExp(`(?:^|[\\s{,(])['"]?(?:${KEYS})['"]?\\s*:\\s*(?:'([^'\\n]*)'|"([^"\\n]*)"|\`([^\`\\n]*)\`)`, 'g');
  stripped.split('\n').forEach((line, i) => {
    for (const m of line.matchAll(re)) out.push([i + 1, m[1] ?? m[2] ?? m[3] ?? '']);
  });
  return out;
}

function mdCandidates(src) {
  return src.split('\n').map((l, i) => [i + 1, l]);
}

function scan(file) {
  const src = readFileSync(join(root, file), 'utf8');
  const lines = src.split('\n');
  const cands = file.endsWith('.html') ? htmlCandidates(src) : file.endsWith('.ts') ? tsCandidates(src) : mdCandidates(src);
  const hits = new Set();
  for (const [line, text] of cands) {
    if (!FORBIDDEN.test(text)) continue;
    if ((lines[line - 1] ?? '').includes(IGNORE) || (lines[line - 2] ?? '').includes(IGNORE)) continue;
    hits.add(line);
  }
  return [...hits].sort((a, b) => a - b);
}

const results = new Map();
for (const f of tracked.filter(inScope)) {
  if (!existsSync(join(root, f))) continue;
  const hits = scan(f);
  if (hits.length) results.set(f, hits);
}

const HEADER = `# Copyright The Linux Foundation and each contributor to LFX.
# SPDX-License-Identifier: MIT

# Known legacy user-facing "organization"/"Org Lens" copy (#5061). Format: <count><TAB><path>.
# Shrink only: S2-S6 lower or delete entries as they fix copy. Regenerate with
# \`node check-company-copy.mjs --update\`. Never add entries for new code.
`;
const render = () =>
  HEADER + [...results.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([f, h]) => `${h.length}\t${f}`)
    .join('\n') + '\n';

if (process.argv.includes('--update')) {
  writeFileSync(allowlistPath, render());
  console.log(`Wrote ${results.size} entries to check-company-copy.allowlist.txt`);
  process.exit(0);
}

const allowed = new Map();
if (existsSync(allowlistPath)) {
  for (const l of readFileSync(allowlistPath, 'utf8').split('\n')) {
    const m = l.match(/^(\d+)\t(.+)$/);
    if (m) allowed.set(m[2], Number(m[1]));
  }
}

let failed = false;
for (const [f, hits] of results) {
  const max = allowed.get(f) ?? 0;
  if (hits.length > max) {
    failed = true;
    console.error(`${f}: ${hits.length} user-facing "organization"/"Org Lens" occurrence(s), ${max} allowed (lines ${hits.join(', ')})`);
  }
}
for (const [f, max] of allowed) {
  const have = results.get(f)?.length ?? 0;
  if (have < max) console.warn(`note: ${f} now has ${have} (allowlist says ${max}); run \`node check-company-copy.mjs --update\` to shrink it`);
}
if (failed) {
  console.error('\nUser-facing copy must say "company" / "companies" / "Company Lens", never "organization" or "Org Lens".');
  console.error('See .claude/rules/copy-terminology.md. Code identifiers, comments and API field names are fine.');
  console.error('Only if a hit is truly not user-facing, add `company-copy-ignore` on that line or the one above.');
  process.exit(1);
}
console.log(`Company copy check passed (${results.size} files with known legacy copy remain on the allowlist).`);
