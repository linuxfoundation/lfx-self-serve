// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';

import { OrgClaSelfRemovalsService } from './org-cla-self-removals.service';

describe('OrgClaSelfRemovalsService', () => {
  it('remembers a removal for that organization and agreement only', () => {
    const service = new OrgClaSelfRemovalsService();

    service.record('org-a', 'signature-1');

    expect(service.removed('org-a', 'signature-1')).toBe(true);
    expect(service.removed('org-a', 'signature-2')).toBe(false);
    expect(service.removed('org-b', 'signature-1')).toBe(false);
  });

  it('forgets every removal once a new CLA list is requested', () => {
    const service = new OrgClaSelfRemovalsService();
    service.record('org-a', 'signature-1');
    service.record('org-b', 'signature-2');

    service.forgetAll();

    expect(service.removed('org-a', 'signature-1')).toBe(false);
    expect(service.removed('org-b', 'signature-2')).toBe(false);
  });
});
