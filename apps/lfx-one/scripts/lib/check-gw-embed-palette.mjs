// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * Guards `gw-embed-theme.css`'s palette against drifting away from `lfxColors`.
 *
 * The theme maps LFX's brand scale onto Radix's 12-step accent/gray scales, which the embed reads.
 * Those mappings are written as literal hex values, and `.claude/rules/styling.md` says brand
 * colours must come from `lfxColors` — the hazard being that a future `lfxColors` update leaves the
 * embedded module on a stale palette while the rest of LFX moves, with nothing to notice.
 *
 * This is the third option, after generating the declarations and after consuming shared CSS
 * variables. Both of those were considered and rejected for the same reason: the Radix scale is NOT
 * a mechanical function of the Tailwind scale. Radix has 12 perceptual steps to Tailwind's 11, and
 * three of the accent steps here are interpolated between brand stops by eye, with the contrast
 * reasoning recorded in comments beside them ("700 clears 4.5:1 on white"). Generating them would
 * bake an arbitrary interpolation into the build and silently re-derive a design decision whenever
 * the brand scale moved; referencing CSS variables would keep the literals, just one level away.
 *
 * So the literals stay readable where the design reasoning lives, and this asserts they still match
 * the scale they were derived from. Drift fails the build with the specific property and both
 * values, which makes a brand update an explicit prompt to re-derive the ramp rather than a silent
 * divergence.
 *
 * Only the values that ARE brand stops are checked. The interpolated steps and plain white have no
 * `lfxColors` counterpart to compare against, and are listed as such rather than skipped silently.
 */

/** `--custom-property` -> `[scale, stop]` in `lfxColors`. */
export const PALETTE_BINDINGS = {
  '--accent-1': ['blue', '50'],
  '--accent-2': ['blue', '100'],
  '--accent-3': ['blue', '200'],
  '--accent-5': ['blue', '300'],
  '--accent-7': ['blue', '400'],
  '--accent-9': ['blue', '600'],
  '--accent-10': ['blue', '700'],
  '--accent-11': ['blue', '700'],
  '--accent-12': ['blue', '900'],
  '--accent-indicator': ['blue', '600'],
  '--accent-track': ['blue', '600'],
  '--accent-surface': ['blue', '100'],
  '--accent-a1': ['blue', '50'],
  '--accent-a2': ['blue', '100'],
  '--accent-a3': ['blue', '200'],
  '--accent-a5': ['blue', '300'],
  '--accent-a7': ['blue', '400'],
  '--accent-a9': ['blue', '600'],
  '--accent-a10': ['blue', '700'],
  '--accent-a11': ['blue', '700'],
  '--accent-a12': ['blue', '900'],
  '--secondary-1': ['blue', '50'],
  '--secondary-2': ['blue', '100'],
  '--secondary-9': ['blue', '600'],
  '--secondary-11': ['blue', '700'],
  '--gray-2': ['gray', '50'],
  '--gray-3': ['gray', '100'],
  '--gray-4': ['gray', '200'],
  '--gray-5': ['gray', '200'],
  '--gray-6': ['gray', '300'],
  '--gray-7': ['gray', '300'],
  '--gray-8': ['gray', '400'],
  '--gray-9': ['gray', '500'],
  '--gray-10': ['gray', '600'],
  '--gray-11': ['gray', '600'],
  '--gray-12': ['gray', '900'],
  '--gray-a2': ['gray', '50'],
  '--gray-a3': ['gray', '100'],
  '--gray-a4': ['gray', '200'],
  '--gray-a5': ['gray', '200'],
  '--gray-a6': ['gray', '300'],
  '--gray-a7': ['gray', '300'],
  '--gray-a8': ['gray', '400'],
  '--gray-a9': ['gray', '500'],
  '--gray-a10': ['gray', '600'],
  '--gray-a11': ['gray', '600'],
  '--gray-a12': ['gray', '900'],
  // Puck (the embed's page composer) reads its own azure ramp rather than the Radix accent scale.
  '--puck-color-azure-07': ['blue', '600'],
};

/**
 * Properties that hold a literal by design, with the reason. Present so the list above reads as
 * exhaustive — an unlisted property that this checker does not know about is a gap, not a silence.
 */
export const UNBOUND_PROPERTIES = {
  '--accent-4': 'interpolated between blue.200 and blue.300 to fill Radix step 4',
  '--accent-6': 'interpolated between blue.300 and blue.400 to fill Radix step 6',
  '--accent-8': 'interpolated between blue.400 and blue.500 to fill Radix step 8',
  '--accent-a4': 'mirrors --accent-4',
  '--accent-a6': 'mirrors --accent-6',
  '--accent-a8': 'mirrors --accent-8',
  '--focus-8': 'mirrors --accent-8',
  '--focus-a8': 'mirrors --accent-8',
  '--accent-contrast': 'white, not a brand stop',
  '--gray-1': 'white, not a brand stop',
  '--gray-a1': 'white, not a brand stop',
  '--color-panel-solid': 'white, not a brand stop',
  '--color-background': 'the app canvas, not a brand stop',
  '--color-surface': 'white, not a brand stop',
  '--puck-color-azure-08': 'mirrors --accent-8',
  '--puck-color-azure-09': 'mirrors --accent-8',
};

/** Pulls `--prop: #hex` declarations out of a stylesheet, lower-cased for comparison. */
export function readPaletteDeclarations(css) {
  const found = {};
  const pattern = /(--[a-z0-9-]+)\s*:\s*(#[0-9a-f]{3,8})\s*;/gi;
  let match;
  while ((match = pattern.exec(css)) !== null) {
    found[match[1]] = match[2].toLowerCase();
  }
  return found;
}

/**
 * Returns a list of drift messages; empty means the palette still matches `lfxColors`.
 *
 * Reports BOTH directions. A binding whose property has vanished from the stylesheet is drift too —
 * it means the mapping table is describing something that no longer exists, and a checker that
 * quietly passes on a missing property stops being evidence of anything.
 */
export function findPaletteDrift(css, lfxColors) {
  const declared = readPaletteDeclarations(css);
  const problems = [];

  for (const [property, [scale, stop]] of Object.entries(PALETTE_BINDINGS)) {
    const expected = lfxColors[scale]?.[stop]?.toLowerCase();
    if (!expected) {
      problems.push(`${property}: lfxColors.${scale}.${stop} no longer exists`);
      continue;
    }
    if (!(property in declared)) {
      problems.push(`${property}: expected in the stylesheet (bound to lfxColors.${scale}.${stop}) but not found`);
      continue;
    }
    if (declared[property] !== expected) {
      problems.push(`${property}: stylesheet has ${declared[property]}, lfxColors.${scale}.${stop} is ${expected}`);
    }
  }

  return problems;
}

/**
 * Reads the brand scales straight out of `colors.constants.ts`.
 *
 * Text extraction rather than importing the module, deliberately. `@linuxfoundation/lfx-ui-core`
 * pulls Angular components in at import time and throws in a plain Node runtime, and the shared
 * package's `dist/` only exists once that package has been built — which couples this check to
 * build ORDER, in a step that deliberately runs before everything else. The source file is always
 * present and is the definition itself, so reading it has neither problem.
 *
 * Scoped to the two scales this theme maps. Parsing is intentionally strict: a scale that cannot be
 * found throws rather than returning empty, because an empty scale would make every comparison
 * below vacuous and the check would pass while verifying nothing.
 */
export function extractBrandScales(source, scales = ['blue', 'gray']) {
  const extracted = {};

  for (const scale of scales) {
    const block = new RegExp(`\\b${scale}:\\s*\\{([^}]*)\\}`, 'm').exec(source);
    if (!block) {
      throw new Error(`check-gw-embed-palette: could not find the "${scale}" scale in colors.constants.ts`);
    }

    const stops = {};
    const stopPattern = /(\d+)\s*:\s*'(#[0-9a-fA-F]{3,8})'/g;
    let match;
    while ((match = stopPattern.exec(block[1])) !== null) {
      stops[match[1]] = match[2];
    }

    if (Object.keys(stops).length === 0) {
      throw new Error(`check-gw-embed-palette: the "${scale}" scale parsed to zero stops`);
    }
    extracted[scale] = stops;
  }

  return extracted;
}
