// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';

import { member360SourceLabel, member360SourceStatusText } from './member-360.utils';

describe('member360SourceLabel', () => {
  it('translates only the literal legacy suffix', () => {
    expect(member360SourceLabel('CRM (not wired)')).toBe('CRM (not connected yet)');
    for (const label of ['LFX Platform', 'CRM (not connected yet)', 'CRM (not wired) temporarily', 'CRM (Not wired)', '']) {
      expect(member360SourceLabel(label)).toBe(label);
    }
  });
});

describe('member360SourceStatusText', () => {
  it.each([
    ['used', 'used'],
    ['unavailable', 'unavailable'],
    ['not_wired', 'not connected yet'],
  ] as const)('presents %s as %s', (status, label) => {
    expect(member360SourceStatusText(status)).toBe(label);
  });
});
