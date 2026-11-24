#!/usr/bin/env node
// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// Warn (never fail) when a change grows the campaign specs by more than 300 net lines, or adds a
// `TestBed.createComponent(` with no state-only fixture nearby (#5980). Run from the repo root:
//
//   node apps/lfx-one/scripts/check-campaign-spec-growth.mjs <base-sha>

import { execFileSync } from 'node:child_process';

import { CAMPAIGN_SPEC_PATHSPEC, findUnmarkedCreateComponent, MAX_NET_SPEC_LINES, parseAddedLines, parseNumstat } from './lib/spec-growth.mjs';

const DOC = 'docs/architecture/testing/unit-testing.md#choose-the-cheapest-test-that-proves-the-behaviour';
const annotate = process.env.GITHUB_ACTIONS === 'true';

function warn(message, file, line) {
  if (!annotate) return console.log(`warning: ${file ? `${file}${line ? `:${line}` : ''}: ` : ''}${message}`);
  const location = file ? ` file=${file}${line ? `,line=${line}` : ''},` : ' ';
  console.log(`::warning${location}title=Campaign spec growth::${message}`);
}

try {
  const base = process.argv[2];
  if (!base || !/^[0-9a-f]{7,40}$/i.test(base)) throw new Error('Usage: check-campaign-spec-growth.mjs <base-sha>');
  const git = (...args) => execFileSync('git', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  const pathspec = `:(glob)${CAMPAIGN_SPEC_PATHSPEC}`;

  const growth = parseNumstat(git('diff', '--numstat', '--no-renames', base, 'HEAD', '--', pathspec));
  const net = growth.reduce((sum, { net: lines }) => sum + lines, 0);
  if (net > MAX_NET_SPEC_LINES) {
    const top = [...growth]
      .sort((a, b) => b.net - a.net)
      .slice(0, 3)
      .map(({ file, net: lines }) => `${file.split('/').pop()} (+${lines})`)
      .join(', ');
    warn(`This change adds ${net} net lines to campaign specs (warning above ${MAX_NET_SPEC_LINES}): ${top}. Prefer a pure function with table tests or the state-only fixture over another full render; see ${DOC}.`);
  }

  let unmarked = 0;
  for (const [file, lines] of parseAddedLines(git('diff', '--unified=0', '--no-renames', base, 'HEAD', '--', pathspec))) {
    if (lines.length === 0) continue;
    const content = git('show', `HEAD:${file}`).split('\n');
    for (const line of findUnmarkedCreateComponent(content, lines)) {
      unmarked += 1;
      warn(`New TestBed.createComponent( with no STATE_ONLY test or state-only fixture nearby. Use a full render only for DOM behaviour; see ${DOC}.`, file, line);
    }
  }
  console.log(`[spec-growth] campaign specs: ${net >= 0 ? '+' : ''}${net} net lines, ${unmarked} new full render(s) without a state-only marker.`);
} catch (error) {
  // Advisory only: a broken check must never block a PR.
  console.log(`[spec-growth] skipped: ${error.message}`);
}
