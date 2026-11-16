// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';

import { ORG_ROLE_AUTHORITY_ORDER } from '../constants';
import type { OrgItem } from '../interfaces';
import { filterOrgItemsByName, isActiveStatus, resolveOrgRolePersona, sortOrgItemsByName } from './org-selector.utils';

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

describe('filterOrgItemsByName / sortOrgItemsByName', () => {
  const row = (name: string): OrgItem => ({ uid: name, accountId: name, name, slug: null, logoUrl: null, isAssigned: true }) as OrgItem;
  const names = (items: OrgItem[]) => items.map((item) => item.name);
  const rows = ['Zeta Labs', 'acme corp', 'Beta Labs', 'Labrador Inc'].map(row);

  it('keeps every row for a blank term', () => {
    expect(filterOrgItemsByName(rows, '  ')).toBe(rows);
    expect(filterOrgItemsByName(rows, undefined)).toBe(rows);
  });

  it('keeps the rows whose name contains the trimmed term, whatever the casing', () => {
    expect(names(filterOrgItemsByName(rows, ' LAB '))).toEqual(['Zeta Labs', 'Beta Labs', 'Labrador Inc']);
  });

  it('sorts alphabetically with no term', () => {
    expect(names(sortOrgItemsByName(rows, undefined))).toEqual(['acme corp', 'Beta Labs', 'Labrador Inc', 'Zeta Labs']);
  });

  it('ranks names starting with the term first, then alphabetically', () => {
    expect(names(sortOrgItemsByName(filterOrgItemsByName(rows, 'lab'), 'lab'))).toEqual(['Labrador Inc', 'Beta Labs', 'Zeta Labs']);
  });

  it('never reorders its input', () => {
    sortOrgItemsByName(rows, undefined);

    expect(names(rows)).toEqual(['Zeta Labs', 'acme corp', 'Beta Labs', 'Labrador Inc']);
  });
});
