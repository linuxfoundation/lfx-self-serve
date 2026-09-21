// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';

import { legacyOrgEasyclaReturnPath, ORG_EASYCLA_PATH, orgEasyclaReturnPath } from './cla.constants';

describe('orgEasyclaReturnPath', () => {
  it('addresses the CLA Group under the organization, as the /org/:orgSegment/easycla/:claGroupId route expects', () => {
    expect(orgEasyclaReturnPath('0014100000Te2ovAAB', 'cla-group-uuid-1')).toBe('/org/0014100000Te2ovAAB/easycla/cla-group-uuid-1');
  });

  // Both values reach the address as single path segments whatever they hold.
  it('encodes both segments', () => {
    expect(orgEasyclaReturnPath('a/b', 'c?d')).toBe('/org/a%2Fb/easycla/c%3Fd');
  });

  it('is the leftover address plus the organization segment', () => {
    expect(ORG_EASYCLA_PATH).toBe('/org/easycla');
    expect(orgEasyclaReturnPath('0014100000Te2ovAAB', 'g')).toBe('/org/0014100000Te2ovAAB/easycla/g');
  });
});

describe('legacyOrgEasyclaReturnPath', () => {
  it('builds the leftover shape under the legacy mount, with no organization in the path', () => {
    expect(legacyOrgEasyclaReturnPath('c1ab2e7d-0000-4000-8000-000000000001')).toBe('/org/easycla/c1ab2e7d-0000-4000-8000-000000000001');
  });

  it('encodes the CLA Group id so it cannot append a segment', () => {
    expect(legacyOrgEasyclaReturnPath('g/../x?y')).toBe('/org/easycla/g%2F..%2Fx%3Fy');
  });
});
