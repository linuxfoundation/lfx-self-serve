// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/** Parse a one-based shard such as 1/4. Reject typos rather than silently running a subset. */
export function parseShard(value) {
  const match = /^([1-9]\d*)\/([1-9]\d*)$/.exec(value ?? '');
  if (!match) throw new Error('Expected a shard in index/count form, e.g. 1/4.');
  const index = Number(match[1]);
  const count = Number(match[2]);
  if (!Number.isSafeInteger(index) || !Number.isSafeInteger(count) || index > count) {
    throw new Error('Shard index must be between 1 and count, both safe positive integers.');
  }
  return { index, count };
}

/**
 * Longest estimated files first, assigned to the lightest shard. Sorting paths breaks ties
 * consistently across machines. Historical timings affect placement only, never discovery.
 *
 * @param {string[]} files
 * @param {number} count
 * @param {Record<string, number>} durations - Seconds for known slow files; others cost one unit.
 */
export function createAppTestShards(files, count, durations = {}) {
  if (!Number.isSafeInteger(count) || count < 1 || count > files.length) {
    throw new Error('Shard count must be positive and cannot exceed the number of specs.');
  }
  if (new Set(files).size !== files.length) throw new Error('Duplicate discovered specs.');

  const weighted = files.map((file) => {
    const seconds = durations[file] ?? 1;
    if (!Number.isFinite(seconds) || seconds <= 0) throw new Error(`Invalid duration for ${file}.`);
    return { file, seconds };
  });
  const comparePaths = (a, b) => (a < b ? -1 : Number(a > b));
  weighted.sort((a, b) => b.seconds - a.seconds || comparePaths(a.file, b.file));
  const shards = Array.from({ length: count }, () => ({ files: [], seconds: 0 }));
  for (const { file, seconds } of weighted) {
    const target = shards.reduce((lightest, candidate) => (candidate.seconds < lightest.seconds ? candidate : lightest));
    target.files.push(file);
    target.seconds += seconds;
  }

  // Fail closed if a future change to the scheduler loses, duplicates, or empties a partition.
  const assigned = shards.flatMap((shard) => shard.files);
  if (
    shards.some((shard) => shard.files.length === 0) ||
    assigned.length !== files.length ||
    new Set(assigned).size !== files.length ||
    files.some((file) => !assigned.includes(file))
  ) {
    throw new Error('Shard plan must contain every discovered spec exactly once, with no empty shards.');
  }
  for (const shard of shards) shard.files.sort(comparePaths);
  return shards;
}
