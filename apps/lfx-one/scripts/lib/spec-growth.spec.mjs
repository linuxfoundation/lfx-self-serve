// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';

import { findUnmarkedCreateComponent, parseAddedLines, parseNumstat } from './spec-growth.mjs';

describe('parseNumstat', () => {
  it.each([
    ['added and deleted', '10\t3\ta.spec.ts', [{ file: 'a.spec.ts', net: 7 }]],
    ['net shrink', '1\t40\ta.spec.ts', [{ file: 'a.spec.ts', net: -39 }]],
    ['binary', '-\t-\tlogo.png', [{ file: 'logo.png', net: 0 }]],
    ['blank output', '', []],
  ])('%s', (_, numstat, expected) => {
    expect(parseNumstat(numstat)).toEqual(expected);
  });
});

describe('parseAddedLines', () => {
  it.each([
    [
      'a modified file with zero context',
      ['diff --git a/x.spec.ts b/x.spec.ts', '--- a/x.spec.ts', '+++ b/x.spec.ts', '@@ -3 +3,2 @@', '-old', '+new', '+newer', '@@ -10,0 +12 @@', '+added'],
      { 'x.spec.ts': [3, 4, 12] },
    ],
    ['a new file', ['--- /dev/null', '+++ b/n.spec.ts', '@@ -0,0 +1,2 @@', '+a', '+b'], { 'n.spec.ts': [1, 2] }],
    ['a deleted file', ['--- a/d.spec.ts', '+++ /dev/null', '@@ -1,2 +0,0 @@', '-a', '-b'], {}],
    ['context lines advance the counter', ['--- a/x', '+++ b/x', '@@ -1,3 +1,3 @@', ' keep', '-old', '+new', ' keep'], { x: [2] }],
    ['an added line that starts with ++ is content', ['--- a/x', '+++ b/x', '@@ -1 +1,2 @@', ' keep', '+++ not a header'], { x: [2] }],
    ['no newline marker', ['--- a/x', '+++ b/x', '@@ -1 +1 @@', '-a', '\\ No newline at end of file', '+b'], { x: [1] }],
  ])('%s', (_, lines, expected) => {
    expect(Object.fromEntries(parseAddedLines(lines.join('\n')))).toEqual(expected);
  });
});

describe('findUnmarkedCreateComponent', () => {
  const file = (...lines) => lines;
  it.each([
    ['a bare full render', file('beforeEach(() => {', '  fixture = TestBed.createComponent(PlanningTabComponent);', '});'), [2], [2]],
    ['through the state-only helper', file('fixture = TestBed.createComponent(tabComponentUnderTest());'), [1], []],
    ['a STATE_ONLY test nearby', file("it('x', STATE_ONLY, () => {", '  fixture = TestBed.createComponent(CampaignsComponent);'), [2], []],
    ['a StateOnly subclass', file('fixture = TestBed.createComponent(StateOnlyImplementationTab);'), [1], []],
    ['a marker outside the radius', file('STATE_ONLY', ...Array(10).fill(''), 'TestBed.createComponent(X);'), [12], [12]],
    ['an untouched existing render', file('TestBed.createComponent(X);', 'const y = 1;'), [2], []],
  ])('%s', (_, lines, added, expected) => {
    expect(findUnmarkedCreateComponent(lines, added)).toEqual(expected);
  });
});
