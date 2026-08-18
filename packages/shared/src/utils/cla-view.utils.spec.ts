// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';

import { PROFILE_TABS } from '../constants/profile.constants';
import { MyClaAgreement, MyClasIdentitySummary } from '../interfaces/cla.interface';
import {
  buildProfileTabs,
  claKindSeverity,
  claStatusLabel,
  claStatusSeverity,
  isMyClasEmpty,
  shouldShowGithubCta,
  splitAgreementsByKind,
} from './cla-view.utils';

function agreement(overrides: Partial<MyClaAgreement> = {}): MyClaAgreement {
  return { id: 's1', kind: 'ICLA', claGroupName: 'P', signedOn: '2022-01-01', status: 'valid', pdfAvailable: true, ...overrides };
}

function identity(overrides: Partial<MyClasIdentitySummary> = {}): MyClasIdentitySummary {
  return { matchedUserIds: 1, unmatched: false, githubLinked: true, ...overrides };
}

describe('buildProfileTabs', () => {
  it('returns the static PROFILE_TABS unchanged when the flag is off', () => {
    expect(buildProfileTabs(false)).toBe(PROFILE_TABS);
  });

  it('inserts the CLAs tab immediately before Transactions when the flag is on', () => {
    const tabs = buildProfileTabs(true);
    const ids = tabs.map((t) => t.id);
    expect(ids).toContain('clas');
    expect(ids.indexOf('clas')).toBe(ids.indexOf('transactions') - 1);
    expect(tabs.find((t) => t.id === 'clas')).toEqual({ id: 'clas', label: 'CLAs', route: 'clas' });
  });

  it('does not mutate the shared PROFILE_TABS constant', () => {
    const before = PROFILE_TABS.length;
    buildProfileTabs(true);
    expect(PROFILE_TABS.length).toBe(before);
    expect(PROFILE_TABS.some((t) => t.id === 'clas')).toBe(false);
  });
});

describe('splitAgreementsByKind', () => {
  it('partitions ICLAs and ECLAs preserving order', () => {
    const list = [agreement({ id: 'i1', kind: 'ICLA' }), agreement({ id: 'e1', kind: 'ECLA', pdfAvailable: false }), agreement({ id: 'i2', kind: 'ICLA' })];
    const { iclas, eclas } = splitAgreementsByKind(list);
    expect(iclas.map((a) => a.id)).toEqual(['i1', 'i2']);
    expect(eclas.map((a) => a.id)).toEqual(['e1']);
  });

  it('returns empty groups for an empty list', () => {
    expect(splitAgreementsByKind([])).toEqual({ iclas: [], eclas: [] });
  });
});

describe('isMyClasEmpty', () => {
  it('is true only when loaded, not errored, and zero agreements', () => {
    expect(isMyClasEmpty(true, false, 0)).toBe(true);
  });

  it('is false while still loading', () => {
    expect(isMyClasEmpty(false, false, 0)).toBe(false);
  });

  it('is false on error (error state takes precedence over empty)', () => {
    expect(isMyClasEmpty(true, true, 0)).toBe(false);
  });

  it('is false when there are agreements', () => {
    expect(isMyClasEmpty(true, false, 3)).toBe(false);
  });
});

describe('shouldShowGithubCta', () => {
  it('is false when identity is undefined (not yet loaded)', () => {
    expect(shouldShowGithubCta(undefined)).toBe(false);
  });

  it('is true when no GitHub account is linked', () => {
    expect(shouldShowGithubCta(identity({ githubLinked: false }))).toBe(true);
  });

  it('is true when nothing matched (unmatched), even if GitHub is linked', () => {
    expect(shouldShowGithubCta(identity({ githubLinked: true, unmatched: true }))).toBe(true);
  });

  it('is false when GitHub is linked and records matched', () => {
    expect(shouldShowGithubCta(identity({ githubLinked: true, unmatched: false }))).toBe(false);
  });
});

describe('claKindSeverity', () => {
  it('maps ICLA to info and ECLA to secondary', () => {
    expect(claKindSeverity('ICLA')).toBe('info');
    expect(claKindSeverity('ECLA')).toBe('secondary');
  });
});

describe('claStatusLabel', () => {
  it('maps each status to its label', () => {
    expect(claStatusLabel('valid')).toBe('Valid');
    expect(claStatusLabel('superseded')).toBe('Superseded');
    expect(claStatusLabel('inactive')).toBe('No longer valid');
  });
});

describe('claStatusSeverity', () => {
  it('maps each status to a badge severity', () => {
    expect(claStatusSeverity('valid')).toBe('success');
    expect(claStatusSeverity('superseded')).toBe('warn');
    expect(claStatusSeverity('inactive')).toBe('secondary');
  });
});
