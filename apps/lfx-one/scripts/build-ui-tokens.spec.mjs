// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { buildUiTokensCss, resolveValue, varName } from './lib/build-ui-tokens.mjs';

const tokens = JSON.parse(readFileSync(resolve(import.meta.dirname, 'ui-tokens/tokens.json'), 'utf8'));
const committed = readFileSync(resolve(import.meta.dirname, '../src/styles/ui-tokens.css'), 'utf8');

describe('ui-tokens.css', () => {
  it('prefixes every custom property with --ui- and never doubles it', () => {
    const names = [...committed.matchAll(/^\s*(--[^:\s]+):/gm)].map((m) => m[1]);
    expect(names.length).toBeGreaterThan(200);
    expect(names.filter((n) => !n.startsWith('--ui-') || n.startsWith('--ui-ui-'))).toEqual([]);
    expect(committed).not.toMatch(/var\(--(?!ui-)/);
  });

  it('matches tokens.json as committed (run `yarn ui:tokens` after editing tokens.json)', () => {
    // Prettier owns whitespace and quote style in the committed file, so compare content only.
    const normalise = (css) => css.replace(/[\s'"]+/g, '');
    expect(normalise(committed)).toBe(normalise(buildUiTokensCss(tokens)));
  });

  it('resolves references and escapes dots in names', () => {
    expect(resolveValue('{azure-500}')).toBe('var(--ui-azure-500)');
    expect(resolveValue('0 0 0 2px {white}, 0 0 0 4px #009aff')).toBe('0 0 0 2px var(--ui-white), 0 0 0 4px #009aff');
    expect(varName('spacing-0.5')).toBe('--ui-spacing-0\\.5');
    expect(varName('ui-neutral-900')).toBe('--ui-neutral-900');
    expect(varName('font-display')).toBe('--ui-font-display');
  });
});
