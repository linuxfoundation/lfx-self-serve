// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';

import { PROFILE_TABS } from '../constants/profile.constants';
import { ClaStatus, MyClaAgreement, MyClasIdentitySummary } from '../interfaces/cla.interface';
import {
  buildProfileTabs,
  claGroupPrimaryName,
  claGroupSecondaryName,
  claKindSeverity,
  claStatusLabel,
  claStatusSeverity,
  isMyClasEmpty,
  shouldShowGithubCta,
  signedAsLine,
  splitAgreementsByKind,
  toClaGroupOptionView,
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
    expect(claStatusLabel('needs_attention')).toBe('Needs attention');
    expect(claStatusLabel('revoked')).toBe('Revoked');
    expect(claStatusLabel('invalidated')).toBe('Invalidated');
    expect(claStatusLabel('unknown')).toBe('—');
    expect(claStatusLabel('superseded')).toBe('Superseded');
  });

  // "Revoked" is the reviewed copy for a sanctions screen. An approval-list removal, a PCC
  // invalidation and a deleted CLA group all arrive as `invalidated`, so lending them this word
  // tells those contributors they were screened. The two labels sharing one word is the specific
  // regression worth pinning, because the token names invite it.
  it('reserves "Revoked" for the sanctions state alone', () => {
    const statuses: ClaStatus[] = ['valid', 'needs_attention', 'revoked', 'invalidated', 'unknown', 'superseded'];
    const revokedLabels = statuses.filter((status) => /revoke/i.test(claStatusLabel(status)));

    expect(revokedLabels).toEqual(['revoked']);
  });

  // Retired in review and, unlike "Invalidated", never reinstated.
  it('never labels a status "Canceled"', () => {
    const statuses: ClaStatus[] = ['valid', 'needs_attention', 'revoked', 'invalidated', 'unknown', 'superseded'];

    expect(statuses.map(claStatusLabel).some((label) => /cancel/i.test(label))).toBe(false);
  });
});

describe('claStatusSeverity', () => {
  it('maps each status to a tag severity', () => {
    expect(claStatusSeverity('valid')).toBe('success');
    expect(claStatusSeverity('needs_attention')).toBe('warn');
    // Revoked is deliberately the quiet one: the design renders it neutral gray and Invalidated red.
    expect(claStatusSeverity('revoked')).toBe('secondary');
    expect(claStatusSeverity('invalidated')).toBe('danger');
    expect(claStatusSeverity('unknown')).toBe('secondary');
    expect(claStatusSeverity('superseded')).toBe('warn');
  });
});

describe('signedAsLine', () => {
  it('adds a platform suffix for GitHub and GitLab, and none for Gerrit/email', () => {
    expect(signedAsLine('github', 'jellis')).toBe('Signed as jellis (GitHub)');
    expect(signedAsLine('gitlab', 'jellis')).toBe('Signed as jellis (GitLab)');
    expect(signedAsLine('gerrit', 'jellis@acme-motors.example')).toBe('Signed as jellis@acme-motors.example');
  });

  it('omits the line when the identity is missing, empty, or whitespace', () => {
    expect(signedAsLine('github', undefined)).toBeUndefined();
    expect(signedAsLine('github', '')).toBeUndefined();
    expect(signedAsLine('github', '   ')).toBeUndefined();
    expect(signedAsLine(undefined, undefined)).toBeUndefined();
  });

  it('prints the identity with no suffix when the platform is missing', () => {
    expect(signedAsLine(undefined, 'jellis')).toBe('Signed as jellis');
  });
});

describe('claGroupPrimaryName / claGroupSecondaryName', () => {
  it('names a result by its CLA group when the producer resolved no project', () => {
    expect(claGroupPrimaryName({ claGroupName: 'CNCF' })).toBe('CNCF');
    expect(claGroupSecondaryName({ claGroupName: 'CNCF' })).toBeNull();
  });

  it('falls back to the unnamed literal only when the producer resolved neither name', () => {
    expect(claGroupPrimaryName({})).toBe('Unnamed CLA group');
    expect(claGroupSecondaryName({})).toBeNull();
  });
});

describe('toClaGroupOptionView', () => {
  it('precomputes labels so the picker template does not have to', () => {
    const view = toClaGroupOptionView({
      claGroupId: 'cg-1',
      projectName: 'Venus test',
      claGroupName: 'Venus ICLA',
      matchTypes: ['project'],
      organizations: [{ name: 'cncf', source: 'github' }],
    });

    expect(view.primaryName).toBe('Venus test');
    expect(view.secondaryName).toBe('Venus ICLA');
    expect(view.matchTypeLabels).toEqual(['Project name']);
    expect(view.orgViews[0]).toEqual({ name: 'cncf', source: 'github', sourceLabel: 'GitHub', sourceIcon: 'fa-brands fa-github' });
    expect(view.expanded).toBe(false);
  });
});
