// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * CLI wrapper around the embed stylesheet containment transform.
 *
 *   node scripts/contain-gw-embed-css.mjs [source.css] [destination.css]
 *
 * Both arguments are optional. With neither, it reads the installed
 * `@gatewaze/admin-embed/admin.css` and writes `public/assets/gw/admin-embed.css` — which is how
 * `yarn build:gw-css` runs it, and every build/serve/watch script runs that first. Pass an explicit
 * source to transform a local, unpublished embed build instead.
 *
 * Deliberately a build step rather than something the outlet does at runtime: the output is
 * deterministic and diffable, and the transform itself is unit-tested in
 * scripts/contain-gw-embed-css.spec.mjs.
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';

import { containCss, SCOPE, NAME_PREFIX, REM_BASELINE_PX } from './lib/contain-gw-embed-css.mjs';
import { findPaletteDrift, findScopeDrift, extractBrandScales } from './lib/check-gw-embed-palette.mjs';

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
const { css, stats, keyframeNames, compoundRootSelectors } = containCss(input);

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
// gw-embed-theme.css writes the SCOPE out by hand, which is why findScopeDrift() below checks the
// two have not diverged. The practical consequences of not being transformed are that its rem
// values are NOT rebased and that keyframe prefixing and @import dropping do not apply to it.
//
// The rem difference is benign and an earlier version of this comment described it wrongly: it
// claimed a `1rem` in the theme means 16px. rem resolves against the root element, and this host's
// root is 14px (styles.scss), which is exactly what the rebase computes — so both land on the same
// number. The real difference is that theme rem tracks the host root dynamically rather than being
// frozen to px at build time.
const themePath = resolve(import.meta.dirname, '../src/styles/gw-embed-theme.css');
const theme = existsSync(themePath) ? `\n${readFileSync(themePath, 'utf8')}\n` : '';

// The theme maps LFX's brand scale onto Radix's, written as literal hex values. Checked against
// `lfxColors` here so a brand update cannot leave the embed on a stale palette unnoticed — see
// lib/check-gw-embed-palette.mjs for why this is a check rather than a generator.
//
// Fails the build rather than warning: a warning in a step that runs before every serve and build
// is a line nobody reads, and the whole point is that palette drift must not pass silently.
if (theme) {
  const colorsSource = readFileSync(resolve(import.meta.dirname, '../../../packages/shared/src/constants/colors.constants.ts'), 'utf8');
  const drift = [...findPaletteDrift(theme, extractBrandScales(colorsSource)), ...findScopeDrift(theme, SCOPE)];
  if (drift.length > 0) {
    console.error('gw-embed-theme.css has drifted:');
    for (const problem of drift) {
      console.error(`  - ${problem}`);
    }
    console.error('\nRe-derive the Radix ramp from the new brand scale (or realign the scope with SCOPE), then update the tables in check-gw-embed-palette.mjs if the mapping changed.');
    process.exit(1);
  }
}

mkdirSync(dirname(destination), { recursive: true });
writeFileSync(destination, `${header}\n${css}\n${theme}`);

console.log(
  `contained ${stats.rules} rules, renamed ${stats.keyframes} keyframes (${keyframeNames.slice(0, 6).join(', ')}${
    keyframeNames.length > 6 ? ', …' : ''
  }), rebased ${stats.remValues} rem values, dropped ${stats.dropped} @import, folded ${compoundRootSelectors.length} compound root selector(s)`
);
console.log(`${source} -> ${destination} (${input.length} -> ${css.length} bytes)`);
