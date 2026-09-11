// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * CLI wrapper around the embed stylesheet containment transform.
 *
 *   node scripts/contain-gw-embed-css.mjs <source.css> <destination.css>
 *
 * Run it whenever the embed is rebuilt — see the local runbook. It is deliberately a build step
 * rather than something the outlet does at runtime: the output is deterministic and diffable, and
 * the transform itself is unit-tested in scripts/contain-gw-embed-css.spec.mjs.
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

import { containCss, SCOPE, NAME_PREFIX, REM_BASELINE_PX } from './lib/contain-gw-embed-css.mjs';

const [, , source, destination] = process.argv;
if (!source || !destination) {
  console.error('usage: contain-gw-embed-css.mjs <source.css> <destination.css>');
  process.exit(1);
}

const input = readFileSync(source, 'utf8');
const { css, stats, keyframeNames } = containCss(input);

const header = [
  '/* Copyright The Linux Foundation and each contributor to LFX.',
  '   SPDX-License-Identifier: MIT */',
  '/* GENERATED — do not edit.',
  `   Produced by scripts/contain-gw-embed-css.mjs from the embed's admin.css.`,
  `   Every rule is scoped to ${SCOPE}; rem rebased at ${REM_BASELINE_PX}px; keyframes prefixed ${NAME_PREFIX}. */`,
].join('\n');

// The LFX theme layer is appended after the contained embed CSS so its token overrides win on
// source order without needing !important, and so it goes through the same scoping guarantees.
const themePath = resolve(import.meta.dirname, '../src/styles/gw-embed-theme.css');
const theme = existsSync(themePath) ? `\n${readFileSync(themePath, 'utf8')}\n` : '';

mkdirSync(dirname(destination), { recursive: true });
writeFileSync(destination, `${header}\n${css}\n${theme}`);

console.log(
  `contained ${stats.rules} rules, renamed ${stats.keyframes} keyframes (${keyframeNames.slice(0, 6).join(', ')}${
    keyframeNames.length > 6 ? ', …' : ''
  }), rebased ${stats.remValues} rem values, dropped ${stats.dropped} @import`
);
console.log(`${source} -> ${destination} (${input.length} -> ${css.length} bytes)`);
