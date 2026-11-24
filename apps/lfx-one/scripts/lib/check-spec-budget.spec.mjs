// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { budgetBlocks, buildSpecBudgetBaseline, checkSpecBudget, formatViolation, SPEC_BUDGET } from './check-spec-budget.mjs';

const FILE = 'src/app/x.spec.ts';
const timing = (ms, tests) => [{ file: FILE, tests, ms }];

describe('checkSpecBudget', () => {
  // Budget 20 s and 150 ms per test, failing above 2x: 40 s and 300 ms per test unlisted.
  it.each([
    ['fast file', timing(5_000, 100), {}, []],
    ['over budget but inside the noise tolerance', timing(39_000, 1_000), {}, []],
    ['over the total, unlisted', timing(41_000, 1_000), {}, [['seconds', 41, 20, 40, false]]],
    ['slow per test, unlisted', timing(6_100, 20), {}, [['msPerTest', 305, 150, 300, false]]],
    ['slow per test, but under the per-test floor', timing(2_900, 1), {}, []],
    ['zero tests run (all skipped)', timing(4_000, 0), {}, []],
    ['listed and within its baseline', timing(40_000, 100), { [FILE]: { seconds: 30, msPerTest: 400 } }, []],
    ['listed and slower than its baseline', timing(61_000, 100), { [FILE]: { seconds: 30, msPerTest: 400 } }, [['seconds', 61, 30, 60, true]]],
    ['a baseline below the budget never tightens it', timing(39_000, 1_000), { [FILE]: { seconds: 10 } }, []],
    // Listed for seconds only, so a per-test failure is against the global budget, not a baseline.
    ['listed for one metric only', timing(10_000, 20), { [FILE]: { seconds: 25 } }, [['msPerTest', 500, 150, 300, false]]],
    ['a baseline for another file does not apply', timing(41_000, 1_000), { 'src/app/other.spec.ts': { seconds: 60 } }, [['seconds', 41, 20, 40, false]]],
  ])('%s', (_, timings, baseline, expected) => {
    const actual = checkSpecBudget(timings, baseline).map(({ metric, measured, limit, failAt, listed }) => [metric, measured, limit, failAt, listed]);
    expect(actual).toEqual(expected);
  });

  it('names the file, its time, the limit and the doc', () => {
    const [violation] = checkSpecBudget(timing(41_000, 1_000), {});
    expect(formatViolation(violation)).toBe(
      'src/app/x.spec.ts took 41.0s, over the budget of 20.0s (fails above 40.0s, 2x for CI noise). See docs/architecture/testing/unit-testing.md#per-file-runtime-budget.'
    );
  });
});

describe('budgetBlocks', () => {
  it.each([
    [undefined, true],
    ['pull_request', true],
    ['merge_group', false],
    ['push', false],
    ['workflow_dispatch', false],
  ])('%s blocks: %s', (eventName, expected) => {
    expect(budgetBlocks(eventName)).toBe(expected);
  });
});

describe('buildSpecBudgetBaseline', () => {
  it.each([
    ['under both budgets', { tests: 100, ms: 10_000 }, undefined],
    ['near the total budget (x1.25 > 20 s)', { tests: 1_000, ms: 16_100 }, { seconds: 20.2 }],
    ['slow per test', { tests: 10, ms: 2_000 }, { msPerTest: 250 }],
    ['slow per test but too short to reach the floor', { tests: 2, ms: 1_000 }, undefined],
    ['both', { tests: 100, ms: 40_000 }, { seconds: 50, msPerTest: 500 }],
  ])('%s', (_, measured, expected) => {
    expect(buildSpecBudgetBaseline([{ file: FILE, ...measured }])[FILE]).toEqual(expected);
  });

  it('passes every file it was built from', () => {
    const timings = [
      { file: 'a', tests: 3, ms: 9_000 },
      { file: 'b', tests: 400, ms: 70_000 },
    ];
    expect(checkSpecBudget(timings, buildSpecBudgetBaseline(timings))).toEqual([]);
  });
});

describe('spec-budget-baseline.json', () => {
  it('lists only limits above the budget', () => {
    const { files } = JSON.parse(readFileSync(new URL('../spec-budget-baseline.json', import.meta.url), 'utf8'));
    for (const entry of Object.values(files)) {
      if (entry.seconds !== undefined) expect(entry.seconds).toBeGreaterThan(SPEC_BUDGET.maxSeconds);
      if (entry.msPerTest !== undefined) expect(entry.msPerTest).toBeGreaterThan(SPEC_BUDGET.maxMsPerTest);
    }
  });
});
