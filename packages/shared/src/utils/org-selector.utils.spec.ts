// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';

import { ORG_ROLE_AUTHORITY_ORDER } from '../constants';
import { isActiveStatus, resolveOrgRolePersona } from './org-selector.utils';

describe('isActiveStatus', () => {
  it.each(['Active', 'active', ' ACTIVE ', 'aCtIvE'])('reads %j as active whatever the casing or padding', (status) => {
    expect(isActiveStatus(status)).toBe(true);
  });

  it.each(['Expired', 'Cancelled', 'Active - Renewal', 'Inactive', '', null, undefined])('reads %j as not active', (status) => {
    expect(isActiveStatus(status)).toBe(false);
  });
});

describe('resolveOrgRolePersona', () => {
  const grants = (over: Partial<Record<'writerSet' | 'inheritedWriterSet' | 'auditorSet' | 'inheritedAuditorSet', string[]>>) => ({
    writerSet: new Set(over.writerSet ?? []),
    inheritedWriterSet: new Set(over.inheritedWriterSet ?? []),
    auditorSet: new Set(over.auditorSet ?? []),
    inheritedAuditorSet: new Set(over.inheritedAuditorSet ?? []),
  });

  it('is authority-first: direct writer, inherited writer, direct auditor, inherited auditor', () => {
    expect(ORG_ROLE_AUTHORITY_ORDER.map(([persona]) => persona)).toEqual(['direct-writer', 'inherited-writer', 'direct-auditor', 'inherited-auditor']);
  });

  it('an inherited writer outranks a direct auditor on the same organization', () => {
    expect(resolveOrgRolePersona('u', grants({ auditorSet: ['u'], inheritedWriterSet: ['u'] }))).toBe('inherited-writer');
  });

  it('a direct writer outranks everything', () => {
    expect(resolveOrgRolePersona('u', grants({ writerSet: ['u'], inheritedWriterSet: ['u'], auditorSet: ['u'], inheritedAuditorSet: ['u'] }))).toBe(
      'direct-writer'
    );
  });

  it('is null with no grant', () => {
    expect(resolveOrgRolePersona('u', grants({ writerSet: ['other'] }))).toBeNull();
  });
});
