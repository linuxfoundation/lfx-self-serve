// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { format, resolveConfig } from 'prettier';
import { describe, expect, it } from 'vitest';

import { buildUiTokensCss, resolveValue, varName } from './lib/build-ui-tokens.mjs';

const tokens = JSON.parse(readFileSync(resolve(import.meta.dirname, 'ui-tokens/tokens.json'), 'utf8'));
const CSS_PATH = resolve(import.meta.dirname, '../src/styles/ui-tokens.css');
const committed = readFileSync(CSS_PATH, 'utf8');

/** The generated CSS as `yarn ui:tokens` commits it: the generator output run through the repo's Prettier config. */
async function generatedAsCommitted() {
  const options = await resolveConfig(CSS_PATH);
  return format(buildUiTokensCss(tokens), { ...options, filepath: CSS_PATH });
}

describe('ui-tokens.css', () => {
  it('prefixes every custom property with --ui- and never doubles it', () => {
    const names = [...committed.matchAll(/^\s*(--[^:\s]+):/gm)].map((m) => m[1]);
    expect(names.length).toBeGreaterThan(200);
    expect(names.filter((n) => !n.startsWith('--ui-') || n.startsWith('--ui-ui-'))).toEqual([]);
    expect(committed).not.toMatch(/var\(--(?!ui-)/);
  });

  it('matches tokens.json as committed (run `yarn ui:tokens` after editing tokens.json)', async () => {
    expect(committed).toBe(await generatedAsCommitted());
  });

  it('fails on a spacing-only hand edit', async () => {
    const edited = committed.replace('0 0 0 1px', '0 001px');
    expect(edited).not.toBe(committed);
    expect(edited).not.toBe(await generatedAsCommitted());
  });

  it('resolves references and escapes non-identifier characters in names', () => {
    expect(resolveValue('{azure-500}')).toBe('var(--ui-azure-500)');
    expect(resolveValue('0 0 0 2px {white}, 0 0 0 4px #009aff')).toBe('0 0 0 2px var(--ui-white), 0 0 0 4px #009aff');
    expect(varName('spacing-0.5')).toBe('--ui-spacing-0\\.5');
    expect(varName('ui-neutral-900')).toBe('--ui-neutral-900');
    expect(varName('font-display')).toBe('--ui-font-display');
    expect(varName('odd\\name')).toBe('--ui-odd\\\\name');
  });
});
