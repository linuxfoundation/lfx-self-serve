// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// Campaign spec growth warning (#5980). Pure parsing of `git diff` output; the CLI in
// scripts/check-campaign-spec-growth.mjs runs git and prints the annotations. It only warns.

export const CAMPAIGN_SPEC_PATHSPEC = 'apps/lfx-one/src/app/modules/dashboards/campaigns/**/*.spec.ts';
export const MAX_NET_SPEC_LINES = 300;
/** Lines either side of a new `TestBed.createComponent(` searched for a state-only marker. */
export const MARKER_RADIUS = 10;

const CREATE_COMPONENT = /TestBed\.createComponent\(/;
// STATE_ONLY tests, the StateOnly* empty-template subclasses, and the *ComponentUnderTest()
// helpers that switch to them (campaigns.spec-helper.ts, implementation-tab.spec-helper.ts).
const STATE_ONLY_MARKER = /\bSTATE_ONLY\b|\bStateOnly\w*|\w+ComponentUnderTest\(\)/;

/**
 * Net lines added per file from `git diff --numstat`. Binary files (`-\t-`) count as zero.
 *
 * @param {string} numstat
 * @returns {{ file: string, net: number }[]}
 */
export function parseNumstat(numstat) {
  return numstat
    .split('\n')
    .map((line) => /^(\d+|-)\t(\d+|-)\t(.+)$/.exec(line))
    .filter(Boolean)
    .map(([, added, deleted, file]) => ({ file, net: (Number(added) || 0) - (Number(deleted) || 0) }));
}

/**
 * New-file line numbers of every added line in a unified diff (any context size).
 *
 * @param {string} diff
 * @returns {Map<string, number[]>}
 */
export function parseAddedLines(diff) {
  const added = new Map();
  let file;
  let line = 0;
  let previous = '';
  for (const text of diff.split('\n')) {
    const header = previous.startsWith('--- ');
    previous = text;
    // A `+++` header always follows `---`; an added line that happens to start with `++ ` does not.
    if (header && text.startsWith('+++ ')) {
      file = text === '+++ /dev/null' ? undefined : text.slice(4).replace(/^b\//, '');
      if (file) added.set(file, []);
      continue;
    }
    const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(text);
    if (hunk) {
      line = Number(hunk[1]);
      continue;
    }
    if (!file || text.startsWith('\\')) continue;
    if (text.startsWith('+')) {
      added.get(file).push(line);
      line += 1;
    } else if (text.startsWith(' ')) {
      line += 1;
    }
  }
  return added;
}

/**
 * Added lines that call `TestBed.createComponent(` with no state-only marker within
 * `radius` lines of the new file. Returns one-based line numbers.
 *
 * @param {string[]} lines - The file's new content, one entry per line.
 * @param {number[]} addedLines - One-based line numbers added by the diff.
 */
export function findUnmarkedCreateComponent(lines, addedLines, radius = MARKER_RADIUS) {
  return addedLines.filter((number) => {
    if (!CREATE_COMPONENT.test(lines[number - 1] ?? '')) return false;
    const nearby = lines.slice(Math.max(0, number - 1 - radius), number + radius);
    return !nearby.some((text) => STATE_ONLY_MARKER.test(text));
  });
}
