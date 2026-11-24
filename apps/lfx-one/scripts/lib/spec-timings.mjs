// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// Per-file timings from the Angular unit-test builder's Vitest output. Shared by the shard
// runner's runtime budget (check-spec-budget.mjs) and the shard-weight refresh
// (refresh-test-durations.mjs), so both read the same lines the same way.

const ANSI = /\u001b\[[0-9;]*m/g;
// GitHub job logs (`gh api .../jobs/<id>/logs`) prefix every line with an ISO timestamp.
const LOG_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z /;
// ` ✓  lfx-one  spec-app-...spec.js (216 tests | 4 skipped) 7948ms`. The status mark is ✓ (pass),
// ❯/×/✗ (failures) or ↓ (all skipped); the project label is optional.
const FILE_LINE = /^\s*[✓❯×✗↓]\s+(?:\S+\s+)?(\S+\.spec\.[cm]?js)\s+\((\d+) tests?((?:\s*\|\s*\d+ [a-z]+)*)\)\s+(\d+(?:\.\d+)?)(ms|s)\s*$/;

/**
 * Parse the per-file summary lines Vitest prints after each spec file. Per-test lines are
 * indented under the file and never match, because they carry no test count.
 *
 * @param {string} text - Raw shard output, with or without ANSI colours and log timestamps.
 * @returns {{ name: string, tests: number, ms: number }[]} `tests` excludes skipped and todo tests.
 */
export function parseVitestFileLines(text) {
  const timings = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(ANSI, '').replace(LOG_TIMESTAMP, '');
    const match = FILE_LINE.exec(line);
    if (!match) continue;
    const [, name, total, extras, amount, unit] = match;
    let notRun = 0;
    for (const [, count, kind] of extras.matchAll(/(\d+) ([a-z]+)/g)) {
      if (kind === 'skipped' || kind === 'todo') notRun += Number(count);
    }
    timings.push({ name, tests: Number(total) - notRun, ms: Number(amount) * (unit === 's' ? 1000 : 1) });
  }
  return timings;
}

/**
 * The name the builder gives a spec's bundle: `src/app/a/b.spec.ts` -> `spec-app-a-b.spec.js`.
 * Directory names contain hyphens, so the mapping only runs this way; callers look names up
 * in a map built from the files they discovered.
 */
export function vitestNameForSpec(file) {
  return `spec-${file.replace(/^src\//, '').replace(/\.ts$/, '.js').split('/').join('-')}`;
}

/**
 * Attach source paths to parsed timings. Unknown names (a spec deleted since, or a builder
 * naming change) are returned separately so callers can decide whether that is fatal.
 *
 * @param {{ name: string, tests: number, ms: number }[]} timings
 * @param {string[]} files - Discovered spec paths relative to the app root.
 */
export function attachSpecPaths(timings, files) {
  const byName = new Map(files.map((file) => [vitestNameForSpec(file), file]));
  const matched = [];
  const unknown = [];
  for (const timing of timings) {
    const file = byName.get(timing.name);
    if (file) matched.push({ ...timing, file });
    else unknown.push(timing.name);
  }
  return { matched, unknown };
}
