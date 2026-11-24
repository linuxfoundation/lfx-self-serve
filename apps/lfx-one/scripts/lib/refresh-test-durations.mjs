// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// Rebuild frontend-test-durations.json from the shards' per-file timings (#5980). Pure; the
// CLI in scripts/refresh-test-durations.mjs fetches the logs and writes the file.

/** Only files at least this slow get a weight; every other spec costs the planner one unit. */
export const MIN_WEIGHT_SECONDS = 3;
/** The refresh workflow asks for a new file when the weights moved by more than this. */
export const DRIFT_THRESHOLD = 0.2;

/**
 * Seconds per spec file for every file that ran for 3 s or longer, rounded to 0.1 s and
 * sorted by path, which is the format #5985 and #6098 used.
 *
 * @param {{ file: string, ms: number }[]} timings
 * @returns {Record<string, number>}
 */
export function buildTestDurations(timings) {
  const slowest = new Map();
  for (const { file, ms } of timings) slowest.set(file, Math.max(ms, slowest.get(file) ?? 0));
  const entries = [...slowest]
    .filter(([, ms]) => ms >= MIN_WEIGHT_SECONDS * 1000)
    .map(([file, ms]) => [file, Math.round(ms / 100) / 10])
    .sort(([a], [b]) => (a < b ? -1 : Number(a > b)));
  return Object.fromEntries(entries);
}

/**
 * How far the planner's weights moved: the summed absolute change over the summed old weight,
 * across every file in either map. A file missing from a map weighs one unit, as it does in
 * createAppTestShards, so a spec crossing the 3 s line counts only by how far it crossed.
 *
 * @param {Record<string, number>} previous
 * @param {Record<string, number>} next
 */
export function weightDrift(previous, next) {
  let moved = 0;
  let total = 0;
  for (const file of new Set([...Object.keys(previous), ...Object.keys(next)])) {
    const before = previous[file] ?? 1;
    moved += Math.abs((next[file] ?? 1) - before);
    total += before;
  }
  return total === 0 ? 0 : moved / total;
}
