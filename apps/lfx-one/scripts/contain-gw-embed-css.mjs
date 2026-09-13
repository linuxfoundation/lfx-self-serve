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
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';

import { containCss, SCOPE, NAME_PREFIX, REM_BASELINE_PX } from './lib/contain-gw-embed-css.mjs';

const [, , sourceArg, destinationArg] = process.argv;

/**
 * Where the embed's stylesheet lives when no source is given.
 *
 * Resolved through Node rather than a relative path into node_modules: Yarn hoists this package to
 * the workspace root, and whether it hoists at all depends on dependency conflicts elsewhere, so a
 * hard-coded `node_modules/...` path breaks the moment that changes. The package's exports map
 * publishes `./admin.css` precisely so this resolution is the supported way in.
 */
function resolveDefaultSource() {
  try {
    return createRequire(import.meta.url).resolve('@gatewaze/admin-embed/admin.css');
  } catch {
    return null;
  }
}

const source = sourceArg ?? resolveDefaultSource();
const destination = destinationArg ?? resolve(import.meta.dirname, '../public/assets/gw/admin-embed.css');

if (!source) {
  console.error(
    'contain-gw-embed-css.mjs: could not resolve @gatewaze/admin-embed/admin.css.\n' +
      'Is the package installed? Pass an explicit source to transform a local build instead:\n' +
      '  node scripts/contain-gw-embed-css.mjs <source.css> <destination.css>'
  );
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

// The LFX theme layer is appended AFTER the contained embed CSS, so its token overrides win on
// source order without needing !important.
//
// It is appended verbatim — containCss() has already run at this point, so the theme does not go
// through it. Scoping is instead the theme file's own responsibility: every top-level selector in
// gw-embed-theme.css writes the SCOPE out by hand. The practical consequences of not being
// transformed are that its rem values are NOT rebased to 14px (so a `1rem` there means 16px
// against the host root, unlike every embed-authored length), and that keyframe prefixing and
// @import dropping do not apply to it either.
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
