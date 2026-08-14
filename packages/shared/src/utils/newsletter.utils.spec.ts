// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';

import { newsletterIssuePath } from './newsletter.utils';

describe('newsletterIssuePath', () => {
  it('builds the relative permalink path from a project slug and newsletter id', () => {
    expect(newsletterIssuePath('cncf', 'abc123')).toBe('/newsletters/cncf/abc123');
  });

  it('does not encode or otherwise transform its inputs', () => {
    expect(newsletterIssuePath('kubernetes', 'issue-42')).toBe('/newsletters/kubernetes/issue-42');
  });
});
