// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';

import { attachSpecPaths, parseVitestFileLines, vitestNameForSpec } from './spec-timings.mjs';

const ESC = '\u001b';

describe('parseVitestFileLines', () => {
  it.each([
    ['a plain pass line', ' ✓  lfx-one  spec-app-a-b.spec.js (74 tests) 5735ms', [{ name: 'spec-app-a-b.spec.js', tests: 74, ms: 5735 }]],
    ['a single test', ' ✓ lfx-one spec-app-x.spec.js (1 test) 303ms', [{ name: 'spec-app-x.spec.js', tests: 1, ms: 303 }]],
    ['skipped and todo tests excluded', ' ✓ lfx-one spec-app-x.spec.js (216 tests | 4 skipped | 2 todo) 7948ms', [{ name: 'spec-app-x.spec.js', tests: 210, ms: 7948 }]],
    ['failed tests still count', ' ❯ lfx-one spec-app-x.spec.js (10 tests | 3 failed) 900ms', [{ name: 'spec-app-x.spec.js', tests: 10, ms: 900 }]],
    ['a time in seconds', ' ✓ spec-app-x.spec.js (4 tests) 1.5s', [{ name: 'spec-app-x.spec.js', tests: 4, ms: 1500 }]],
    [
      'ANSI colours and a GitHub log timestamp',
      `2026-11-23T23:59:07.7401318Z  ${ESC}[32m✓${ESC}[39m ${ESC}[30m${ESC}[42m lfx-one ${ESC}[49m${ESC}[39m spec-app-a.spec.js ${ESC}[2m(${ESC}[22m${ESC}[2m74 tests${ESC}[22m${ESC}[2m)${ESC}[22m${ESC}[33m 5735${ESC}[2mms${ESC}[22m${ESC}[39m`,
      [{ name: 'spec-app-a.spec.js', tests: 74, ms: 5735 }],
    ],
    ['an indented per-test line', '     ✓ sends the brief and shows a success toast on a 200  483ms', []],
    ['the run summary', ' Test Files  31 passed (31)', []],
  ])('%s', (_, text, expected) => {
    expect(parseVitestFileLines(text)).toEqual(expected);
  });

  it('reads every file line from multi-line output, with CRLF', () => {
    const text = ['noise', ' ✓ spec-app-a.spec.js (2 tests) 10ms', '   ✓ test 5ms', ' ✓ spec-app-b.spec.js (3 tests) 20ms'].join('\r\n');
    expect(parseVitestFileLines(text).map(({ name }) => name)).toEqual(['spec-app-a.spec.js', 'spec-app-b.spec.js']);
  });
});

describe('vitestNameForSpec / attachSpecPaths', () => {
  it.each([
    ['src/app/modules/committees/components/weekly-brief-card/weekly-brief-card.component.spec.ts', 'spec-app-modules-committees-components-weekly-brief-card-weekly-brief-card.component.spec.js'],
    ['src/app/app.spec.ts', 'spec-app-app.spec.js'],
  ])('%s -> %s', (file, name) => {
    expect(vitestNameForSpec(file)).toBe(name);
  });

  it('maps known names back to paths and reports the rest', () => {
    const files = ['src/app/a-b/c.spec.ts'];
    expect(attachSpecPaths([{ name: 'spec-app-a-b-c.spec.js', tests: 1, ms: 5 }, { name: 'spec-app-gone.spec.js', tests: 1, ms: 5 }], files)).toEqual({
      matched: [{ name: 'spec-app-a-b-c.spec.js', tests: 1, ms: 5, file: 'src/app/a-b/c.spec.ts' }],
      unknown: ['spec-app-gone.spec.js'],
    });
  });
});
