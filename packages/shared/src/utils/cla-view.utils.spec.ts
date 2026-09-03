// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';

import { ALREADY_SIGNED_CLA_LABEL } from '../constants/cla.constants';
import { PROFILE_TABS } from '../constants/profile.constants';
import { ClaGroupOrg, ClaGroupOrgSource, ClaSignedVia, ClaStatus, MyClaAgreement, MyClasIdentitySummary } from '../interfaces/cla.interface';
import {
  alreadySignedAgreementForGroup,
  alreadySignedAgreementForIdentity,
  alreadySignedAgreementsForGroup,
  alreadySignedChipLabel,
  alreadySignedGroupTooltip,
  alreadySignedIdentityTooltip,
  buildProfileTabs,
  claGroupPrimaryName,
  claGroupSecondaryName,
  claKindSeverity,
  claSignRoute,
  claStatusLabel,
  claStatusSeverity,
  formatClaSignedOn,
  gerritSignUrl,
  isMyClasEmpty,
  resolveGerritContractType,
  shouldShowGithubCta,
  signedAsLine,
  splitAgreementsByKind,
  toClaGroupOptionView,
} from './cla-view.utils';

function agreement(overrides: Partial<MyClaAgreement> = {}): MyClaAgreement {
  return { id: 's1', kind: 'ICLA', claGroupName: 'P', signedOn: '2022-01-01T18:40:42Z', status: 'valid', pdfAvailable: true, ...overrides };
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

describe('formatClaSignedOn', () => {
  // The three shapes from #2032. UTC pin vs local is a no-op on the first two; the third
  // is the reported off-by-one (Pacific afternoon → next UTC calendar day).
  const afternoonPacific = '2026-09-01T17:30:00-07:00';

  it('renders a Pacific-afternoon timestamp as Sep 1 locally and Sep 2 in UTC', () => {
    expect(formatClaSignedOn(afternoonPacific, 'America/Los_Angeles')).toBe('Sep 1, 2026');
    expect(formatClaSignedOn(afternoonPacific, 'UTC')).toBe('Sep 2, 2026');
  });

  it('keeps same-calendar-day timestamps on the same date in Pacific and UTC', () => {
    expect(formatClaSignedOn('2026-05-01T18:40:42Z', 'America/Los_Angeles')).toBe('May 1, 2026');
    expect(formatClaSignedOn('2026-05-01T18:40:42Z', 'UTC')).toBe('May 1, 2026');
    expect(formatClaSignedOn('2026-05-08T23:24:50.232159+00:00', 'America/Los_Angeles')).toBe('May 8, 2026');
    expect(formatClaSignedOn('2026-05-08T23:24:50.232159+00:00', 'UTC')).toBe('May 8, 2026');
  });

  it('pins a bare YYYY-MM-DD to UTC so a negative-offset host does not shift the calendar day', () => {
    expect(formatClaSignedOn('2022-01-01')).toBe('Jan 1, 2022');
    expect(formatClaSignedOn('2022-01-01', 'America/Los_Angeles')).toBe('Jan 1, 2022');
  });

  it('omits timeZone on the production no-argument path so a UTC re-pin fails this test', () => {
    const seen: (Intl.DateTimeFormatOptions | undefined)[] = [];
    const original = Date.prototype.toLocaleDateString;
    // eslint-disable-next-line no-extend-native
    Date.prototype.toLocaleDateString = function (locales?: unknown, options?: Intl.DateTimeFormatOptions): string {
      seen.push(options);
      return original.call(this, locales as string, options);
    };
    try {
      formatClaSignedOn(afternoonPacific);
    } finally {
      // eslint-disable-next-line no-extend-native
      Date.prototype.toLocaleDateString = original;
    }

    expect(seen.length).toBeGreaterThan(0);
    expect(seen.at(-1)?.timeZone).toBeUndefined();
  });

  it('returns an em dash for missing, blank, or unparseable values', () => {
    expect(formatClaSignedOn('')).toBe('—');
    expect(formatClaSignedOn('   ')).toBe('—');
    expect(formatClaSignedOn('not-a-date')).toBe('—');
  });

  it('refuses impossible calendar dates rather than rolling them over', () => {
    expect(formatClaSignedOn('2026-02-31')).toBe('—');
    expect(formatClaSignedOn('2026-02-31T10:00:00Z')).toBe('—');
    expect(formatClaSignedOn('0001-01-01')).toBe('—');
  });
});

describe('signedAsLine', () => {
  it('adds a platform suffix for GitHub, GitLab, and Gerrit', () => {
    expect(signedAsLine('github', 'jellis')).toBe('Signed as jellis (GitHub)');
    expect(signedAsLine('gitlab', 'jellis')).toBe('Signed as jellis (GitLab)');
    expect(signedAsLine('gerrit', 'jellis@acme-motors.example')).toBe('Signed as jellis@acme-motors.example (Gerrit)');
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

  it('does not lend the Gerrit label to a token it does not recognise', () => {
    // The BFF mapper narrows unknown wire tokens to undefined, so this branch is only
    // reachable by cast. Pinned so a future token cannot inherit the Gerrit label.
    expect(signedAsLine('bitbucket' as ClaSignedVia, 'jellis')).toBe('Signed as jellis');
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

describe('alreadySignedAgreementForGroup', () => {
  it('returns the first already-signed agreement for that CLA group', () => {
    const held = agreement({ claGroupId: 'cg-1', kind: 'ICLA', status: 'valid' });
    expect(alreadySignedAgreementForGroup([held, agreement({ id: 's2', claGroupId: 'cg-2' })], 'cg-1')).toBe(held);
  });

  it('does not treat an invalidated agreement as already signed', () => {
    expect(alreadySignedAgreementForGroup([agreement({ claGroupId: 'cg-1', status: 'invalidated' })], 'cg-1')).toBeUndefined();
  });

  it('treats needs-attention, revoked, unknown, and superseded as already signed', () => {
    const statuses: ClaStatus[] = ['needs_attention', 'revoked', 'unknown', 'superseded'];
    for (const status of statuses) {
      expect(alreadySignedAgreementForGroup([agreement({ claGroupId: 'cg-1', status })], 'cg-1')?.status).toBe(status);
    }
  });

  it('ignores a blank group id and a row with no group id', () => {
    expect(alreadySignedAgreementForGroup([agreement({ claGroupId: 'cg-1' })], '   ')).toBeUndefined();
    expect(alreadySignedAgreementForGroup([agreement({})], 'cg-1')).toBeUndefined();
  });
});

describe('alreadySignedAgreementsForGroup', () => {
  it('returns every already-signed agreement for the group, so each identity can be checked', () => {
    const mine = agreement({ id: 's1', claGroupId: 'cg-1', signedVia: 'github', signedAs: 'jellis' });
    const other = agreement({ id: 's2', claGroupId: 'cg-1', signedVia: 'gerrit', signedAs: 'jellis-lf' });

    expect(alreadySignedAgreementsForGroup([mine, other, agreement({ id: 's3', claGroupId: 'cg-2' })], 'cg-1')).toEqual([mine, other]);
  });

  it('drops invalidated rows and returns nothing for a blank group id', () => {
    expect(alreadySignedAgreementsForGroup([agreement({ claGroupId: 'cg-1', status: 'invalidated' })], 'cg-1')).toEqual([]);
    expect(alreadySignedAgreementsForGroup([agreement({ claGroupId: 'cg-1' })], '  ')).toEqual([]);
  });
});

describe('alreadySignedChipLabel', () => {
  it('names the identity that signed it', () => {
    expect(alreadySignedChipLabel(agreement({ signedVia: 'github', signedAs: 'jellis' }))).toBe('Already signed as jellis (GitHub)');
  });

  it('falls back to the bare label when no identity was recorded', () => {
    expect(alreadySignedChipLabel(agreement({}))).toBe(ALREADY_SIGNED_CLA_LABEL);
  });
});

describe('alreadySignedGroupTooltip', () => {
  it('names the ICLA, the identity it was signed as, and that another identity may still sign', () => {
    expect(alreadySignedGroupTooltip(agreement({ kind: 'ICLA', signedVia: 'github', signedAs: 'jellis' }), 'github')).toBe(
      'You already have an ICLA for this CLA group. Signed as jellis (GitHub). If you have another identity linked, you can still sign with it.'
    );
  });

  it('names the employer when an ECLA has no signed-as identity', () => {
    expect(alreadySignedGroupTooltip(agreement({ kind: 'ECLA', companyName: 'Acme', pdfAvailable: false }), 'github')).toBe(
      'You already have an ECLA for this CLA group, covered by Acme. If you have another identity linked, you can still sign with it.'
    );
  });

  it('falls back to the kind alone when there is nothing else to name', () => {
    expect(alreadySignedGroupTooltip(agreement({ kind: 'ICLA' }), 'github')).toBe(
      'You already have an ICLA for this CLA group. If you have another identity linked, you can still sign with it.'
    );
  });

  it('promises no other identity on a GitLab-only group, which no identity can sign', () => {
    // The block there is the route, not the account: Self Serve cannot sign a GitLab-only group
    // at all, so offering "link another identity" as the way out would be a dead end.
    expect(alreadySignedGroupTooltip(agreement({ kind: 'ICLA', signedVia: 'gitlab', signedAs: 'jellis' }), 'gitlab-unsupported')).toBe(
      'You already have an ICLA for this CLA group. Signed as jellis (GitLab).'
    );
  });

  it('promises no other identity on a Gerrit-only group, which offers exactly one card', () => {
    // The next step offers only the contributor's own LF identity there, so no GitHub account
    // they link can sign this group — naming one as the way out would be a dead end.
    expect(alreadySignedGroupTooltip(agreement({ kind: 'ICLA', signedVia: 'gerrit', signedAs: 'jellis-lf' }), 'gerrit')).toBe(
      'You already have an ICLA for this CLA group. Signed as jellis-lf (Gerrit).'
    );
  });

  it('keeps the sentence where more than one identity is on offer', () => {
    expect(alreadySignedGroupTooltip(agreement({ kind: 'ICLA', signedVia: 'github', signedAs: 'jellis' }), 'github-or-gerrit')).toBe(
      'You already have an ICLA for this CLA group. Signed as jellis (GitHub). If you have another identity linked, you can still sign with it.'
    );
  });
});

describe('alreadySignedAgreementForIdentity', () => {
  const held = [
    agreement({ id: 's1', claGroupId: 'cg-1', signedVia: 'github', signedAs: 'Jellis' }),
    agreement({ id: 's2', claGroupId: 'cg-1', signedVia: 'gerrit', signedAs: 'jellis-lf' }),
  ];

  /** The handles the step is offering, which is how a recorded number is told from a handle. */
  const offered = ['jellis', 'jellis-work'];

  it('matches a GitHub handle regardless of case', () => {
    expect(alreadySignedAgreementForIdentity(held, { platform: 'github', username: 'jellis', githubId: '12345' }, offered)?.id).toBe('s1');
  });

  it('leaves the contributor a second GitHub account to sign with', () => {
    expect(alreadySignedAgreementForIdentity(held, { platform: 'github', username: 'jellis-work', githubId: '67890' }, offered)).toBeUndefined();
  });

  it('matches the Gerrit identity on the platform alone', () => {
    expect(alreadySignedAgreementForIdentity(held, { platform: 'gerrit' }, offered)?.id).toBe('s2');
    expect(alreadySignedAgreementForIdentity([held[0]!], { platform: 'gerrit' }, offered)).toBeUndefined();
  });

  it('never blocks a GitHub card on an agreement with no recorded identity', () => {
    const blank = [agreement({ claGroupId: 'cg-1', signedVia: 'github', signedAs: '   ' })];
    expect(alreadySignedAgreementForIdentity(blank, { platform: 'github', username: 'jellis', githubId: '12345' }, offered)).toBeUndefined();
  });

  it('still blocks the Gerrit card on an agreement with no recorded identity', () => {
    // The asymmetry is deliberate, not an oversight: a GitHub blank could match any of several
    // accounts, so it matches none, while only one Gerrit card is ever offered and it is the
    // contributor's own LF identity — so the platform alone identifies it.
    const blank = [agreement({ claGroupId: 'cg-1', signedVia: 'gerrit', signedAs: undefined })];
    expect(alreadySignedAgreementForIdentity(blank, { platform: 'gerrit' }, offered)?.claGroupId).toBe('cg-1');
  });

  it('matches the account number when that is what the producer recorded', () => {
    // The producer derives one identity string per agreement — the handle when it had one, the
    // account number when it did not. Comparing only the handle would leave the very account
    // that signed selectable, which is the redundant signature this is meant to prevent.
    const byNumber = [agreement({ id: 's3', claGroupId: 'cg-1', signedVia: 'github', signedAs: '12345' })];

    expect(alreadySignedAgreementForIdentity(byNumber, { platform: 'github', username: '', githubId: '12345' }, ['', 'jellis'])?.id).toBe('s3');
    expect(alreadySignedAgreementForIdentity(byNumber, { platform: 'github', username: 'jellis', githubId: '67890' }, ['', 'jellis'])).toBeUndefined();
  });

  it('reads a numeric identity as a handle when a card on the step carries it', () => {
    // Handles can be all digits: `12345` is a real login, and its account number is something
    // else entirely. So one string can be one card's handle and another card's number, and the
    // handle has to win — otherwise signing as the numerically-named account would gray an
    // unrelated one, which on a single-account step leaves nothing to pick.
    const collides = [agreement({ id: 's4', claGroupId: 'cg-1', signedVia: 'github', signedAs: '12345' })];
    const bothOffered = ['12345', 'jellis'];

    expect(alreadySignedAgreementForIdentity(collides, { platform: 'github', username: '12345', githubId: '18281050' }, bothOffered)?.id).toBe('s4');
    expect(alreadySignedAgreementForIdentity(collides, { platform: 'github', username: 'jellis', githubId: '12345' }, bothOffered)).toBeUndefined();
  });

  it('does not block on an invalidated agreement', () => {
    const invalidated = [agreement({ claGroupId: 'cg-1', status: 'invalidated', signedVia: 'github', signedAs: 'jellis' })];
    expect(alreadySignedAgreementForIdentity(invalidated, { platform: 'github', username: 'jellis', githubId: '12345' }, offered)).toBeUndefined();
  });
});

describe('alreadySignedIdentityTooltip', () => {
  it('says which kind this account already holds and to pick another', () => {
    expect(alreadySignedIdentityTooltip(agreement({ kind: 'ICLA' }), true)).toBe(
      'You already have an ICLA for this CLA group signed with this account. Choose another identity to sign again.'
    );
  });

  it('states the position without prescribing a way out when nothing else is selectable', () => {
    expect(alreadySignedIdentityTooltip(agreement({ kind: 'ICLA' }), false)).toBe('You already have an ICLA for this CLA group signed with this account.');
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

/**
 * The routing table of #2002, row by row.
 *
 * What these protect is not "the right branch runs" so much as the rule the branches encode:
 * a route is chosen on a source being present, never on one being absent. The empty-list case
 * is the one to read first: an empty list means nothing is linked or nothing resolved rather
 * than "not GitHub", those groups are signable today, and a rule that inferred anything from
 * that would misroute them.
 */
describe('claSignRoute', () => {
  function orgs(...sources: ClaGroupOrgSource[]): ClaGroupOrg[] {
    return sources.map((source, index) => ({ name: `org-${index}`, source }));
  }

  it('keeps an empty organization list on the GitHub path', () => {
    // Not an edge case. A CLA group with nothing linked is still searchable by name and still
    // signable; treating "nothing linked" as "not GitHub" would strand every one of them.
    expect(claSignRoute([])).toBe('github');
  });

  it('routes a GitHub-only group to GitHub', () => {
    expect(claSignRoute(orgs('github'))).toBe('github');
  });

  it('routes a Gerrit-only group to Gerrit', () => {
    expect(claSignRoute(orgs('gerrit'))).toBe('gerrit');
  });

  it('routes a GitLab-only group to the unsupported block', () => {
    expect(claSignRoute(orgs('gitlab'))).toBe('gitlab-unsupported');
  });

  it('ignores GitLab on a group that is also linked to GitHub', () => {
    // Signable through GitHub, so there is nothing to block and nothing to explain.
    expect(claSignRoute(orgs('github', 'gitlab'))).toBe('github');
  });

  it('ignores GitLab on a group that is also linked to Gerrit', () => {
    expect(claSignRoute(orgs('gitlab', 'gerrit'))).toBe('gerrit');
  });

  it('offers both identities on a group linked to GitHub and Gerrit', () => {
    expect(claSignRoute(orgs('github', 'gerrit'))).toBe('github-or-gerrit');
  });

  it('offers both identities on a group linked to all three, and never GitLab', () => {
    expect(claSignRoute(orgs('github', 'gitlab', 'gerrit'))).toBe('github-or-gerrit');
  });

  it('does not let source order decide a mixed group', () => {
    // The mixed test has to run before the single-source ones. If it did not, whichever source
    // came first in the list would silently win and the contributor would never be asked.
    expect(claSignRoute(orgs('gerrit', 'github'))).toBe('github-or-gerrit');
    expect(claSignRoute(orgs('github', 'gerrit'))).toBe('github-or-gerrit');
  });

  it('falls back to GitHub for a non-empty list carrying no recognised source', () => {
    // Unreachable through the search mapper, which drops unknown sources. It carries no
    // positive evidence either way, so it lands on today's behaviour rather than on a block.
    expect(claSignRoute([{ name: 'somewhere', source: 'bitbucket' as ClaGroupOrgSource }])).toBe('github');
  });
});

describe('gerritSignUrl', () => {
  const RETURN_URL = 'https://app.dev.lfx.dev/profile/clas';

  it('composes the Console Gerrit route for the individual agreement', () => {
    expect(gerritSignUrl('https://easycla.example.org', 'cg-1', RETURN_URL, 'individual')).toBe(
      'https://easycla.example.org/#/cla/gerrit/project/cg-1/individual?redirect=https%3A%2F%2Fapp.dev.lfx.dev%2Fprofile%2Fclas'
    );
  });

  it('composes the Console Gerrit route for the corporate agreement', () => {
    expect(gerritSignUrl('https://easycla.example.org', 'cg-1', RETURN_URL, 'corporate')).toBe(
      'https://easycla.example.org/#/cla/gerrit/project/cg-1/corporate?redirect=https%3A%2F%2Fapp.dev.lfx.dev%2Fprofile%2Fclas'
    );
  });

  it('tolerates a base with trailing slashes, as every configured one has', () => {
    expect(gerritSignUrl('https://easycla.example.org//', 'cg-1', RETURN_URL, 'individual')).toBe(
      'https://easycla.example.org/#/cla/gerrit/project/cg-1/individual?redirect=https%3A%2F%2Fapp.dev.lfx.dev%2Fprofile%2Fclas'
    );
  });

  it('encodes the return address so its own query string cannot escape into ours', () => {
    const url = gerritSignUrl('https://easycla.example.org', 'cg-1', 'https://app.example.org/profile/clas?a=1&b=2', 'individual');

    expect(url).toContain('redirect=https%3A%2F%2Fapp.example.org%2Fprofile%2Fclas%3Fa%3D1%26b%3D2');
    // One query parameter, not three: an unencoded return address would have added two more.
    expect(url?.split('?')).toHaveLength(2);
  });

  it('returns nothing when the Console base is unset', () => {
    // The caller reports a failure instead. Navigating to a relative address would resolve it
    // against our own origin and land the contributor on a page that cannot sign anything.
    expect(gerritSignUrl('', 'cg-1', RETURN_URL, 'individual')).toBeNull();
    expect(gerritSignUrl('   ', 'cg-1', RETURN_URL, 'individual')).toBeNull();
  });

  it('returns nothing when the Console base is not an absolute address', () => {
    expect(gerritSignUrl('easycla.example.org', 'cg-1', RETURN_URL, 'individual')).toBeNull();
  });

  it('returns nothing when the CLA group id is missing', () => {
    expect(gerritSignUrl('https://easycla.example.org', '', RETURN_URL, 'individual')).toBeNull();
    expect(gerritSignUrl('https://easycla.example.org', '  ', RETURN_URL, 'individual')).toBeNull();
  });
});

describe('resolveGerritContractType', () => {
  it('returns chooser when both types are enabled', () => {
    expect(resolveGerritContractType(true, true)).toBe('chooser');
  });

  it('returns individual when only ICLA is enabled', () => {
    expect(resolveGerritContractType(true, false)).toBe('individual');
  });

  it('returns corporate when only CCLA is enabled', () => {
    expect(resolveGerritContractType(false, true)).toBe('corporate');
  });

  it('returns none when neither type is enabled', () => {
    expect(resolveGerritContractType(false, false)).toBe('none');
  });
});
