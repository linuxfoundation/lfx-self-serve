// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// Per-spec-file runtime budget for the frontend shards (#5980). Pure: the shard runner feeds it
// the timings it parsed and the ratchet baseline, and prints whatever comes back.

export const SPEC_BUDGET_DOC = 'docs/architecture/testing/unit-testing.md#per-file-runtime-budget';

/**
 * - `maxSeconds` / `maxMsPerTest`: the budget a spec file is held to.
 * - `perTestMinSeconds`: the per-test average only counts once a file runs this long. Below it the
 *   average is dominated by one-off TestBed and compile cost, and the file barely moves a shard.
 * - `noiseTolerance`: a file fails only when it exceeds its limit by this factor. Shards run files
 *   in parallel on a shared runner, so files with the same test count varied up to 1.8x (p90 1.48x)
 *   between two main runs (45257334939 and 45292906999), and one unchanged file reached 2.06x its
 *   recorded time in merge queue run 45324459716. The baseline's 25% headroom plus this factor puts
 *   a listed file's failure point at 2.5x its recorded time.
 */
export const SPEC_BUDGET = Object.freeze({
  maxSeconds: 20,
  maxMsPerTest: 150,
  perTestMinSeconds: 3,
  noiseTolerance: 2,
});

/**
 * Whether a budget violation fails this run. Only pull requests (and local runs) fail: the change
 * that slowed a file is caught there, and a noisy runner must not drop an unrelated PR from the merge
 * queue or turn main red. Other events still annotate the violation as a warning.
 *
 * @param {string | undefined} eventName - `GITHUB_EVENT_NAME`.
 */
export function budgetBlocks(eventName) {
  return !eventName || eventName === 'pull_request';
}

/** Headroom recorded in the baseline over a file's measured time. */
export const BASELINE_HEADROOM = 1.25;

/**
 * Check parsed shard timings against the budget. A file listed in the baseline is held to the
 * larger of the budget and its own recorded limit, so it fails only if it gets slower than it was.
 *
 * @param {{ file: string, tests: number, ms: number }[]} timings
 * @param {Record<string, { seconds?: number, msPerTest?: number }>} baseline - `files` of spec-budget-baseline.json.
 * @param {typeof SPEC_BUDGET} [budget]
 * @returns {{ file: string, metric: 'seconds' | 'msPerTest', measured: number, limit: number, failAt: number, listed: boolean }[]}
 */
export function checkSpecBudget(timings, baseline = {}, budget = SPEC_BUDGET) {
  const violations = [];
  for (const { file, tests, ms } of timings) {
    const entry = Object.hasOwn(baseline, file) ? baseline[file] : undefined;
    const seconds = ms / 1000;
    const limits = {
      seconds: Math.max(budget.maxSeconds, entry?.seconds ?? 0),
      msPerTest: Math.max(budget.maxMsPerTest, entry?.msPerTest ?? 0),
    };
    const measured = { seconds, msPerTest: tests > 0 ? ms / tests : 0 };
    const metrics = seconds >= budget.perTestMinSeconds && tests > 0 ? ['seconds', 'msPerTest'] : ['seconds'];
    for (const metric of metrics) {
      const failAt = limits[metric] * budget.noiseTolerance;
      if (measured[metric] > failAt) {
        // `listed` only when the baseline value for THIS metric set the limit, so the message
        // never calls the global budget a baseline.
        const global = metric === 'seconds' ? budget.maxSeconds : budget.maxMsPerTest;
        violations.push({ file, metric, measured: measured[metric], limit: limits[metric], failAt, listed: (entry?.[metric] ?? 0) > global });
      }
    }
  }
  return violations;
}

/** One line per violation: the file, what it measured, its limit, and what to read. */
export function formatViolation({ file, metric, measured, limit, failAt, listed }) {
  const unit = metric === 'seconds' ? (value) => `${value.toFixed(1)}s` : (value) => `${Math.round(value)}ms per test`;
  const whose = listed ? 'its baseline limit' : 'the budget';
  return `${file} took ${unit(measured)}, over ${whose} of ${unit(limit)} (fails above ${unit(failAt)}, ${SPEC_BUDGET.noiseTolerance}x for CI noise). See ${SPEC_BUDGET_DOC}.`;
}

/**
 * Baseline entries for today's files: every file whose measured time plus headroom exceeds a
 * budget, recorded at that measured time plus headroom (rounded up: 0.1 s, 1 ms). Files whose
 * per-test average cannot count yet are still listed when noise could push them past
 * `perTestMinSeconds`, so a slow runner does not fail an unchanged small file.
 *
 * @param {{ file: string, tests: number, ms: number }[]} timings
 * @param {typeof SPEC_BUDGET} [budget]
 */
export function buildSpecBudgetBaseline(timings, budget = SPEC_BUDGET) {
  const files = {};
  const reachesPerTestFloor = (ms) => (ms / 1000) * budget.noiseTolerance * BASELINE_HEADROOM >= budget.perTestMinSeconds;
  for (const { file, tests, ms } of [...timings].sort((a, b) => (a.file < b.file ? -1 : Number(a.file > b.file)))) {
    const seconds = Math.ceil((ms / 1000) * BASELINE_HEADROOM * 10) / 10;
    const msPerTest = tests > 0 ? Math.ceil((ms / tests) * BASELINE_HEADROOM) : 0;
    const entry = {};
    if (seconds > budget.maxSeconds) entry.seconds = seconds;
    if (msPerTest > budget.maxMsPerTest && reachesPerTestFloor(ms)) entry.msPerTest = msPerTest;
    if (Object.keys(entry).length > 0) files[file] = entry;
  }
  return files;
}
