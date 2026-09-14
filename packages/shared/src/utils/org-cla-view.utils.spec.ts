// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';

import type { OrgClaGroup, OrgClaSignSelection } from '../interfaces/cla.interface';
import { orgClaCoverageChips, orgClaCoverageSummary, orgClaGroupForAddress, orgClaOpenLabel, orgClaPreviewGroup } from './org-cla-view.utils';

describe('orgClaOpenLabel', () => {
  it('names the agreement alone when nothing else distinguishes it', () => {
    expect(orgClaOpenLabel({ claGroupName: 'Nimbus Foundation CLA' })).toBe('Open Nimbus Foundation CLA');
  });

  // The case the label exists for: an organization signing under several entities gets one row per
  // entity, all carrying the same CLA Group name. Naming only the group leaves a screen-reader user
  // with identical links and no way to tell which entity each opens.
  it('distinguishes two rows that share a CLA Group name by their signing entity', () => {
    const first = orgClaOpenLabel({ claGroupName: 'Nimbus Foundation CLA', signingEntityName: 'Acme Motors GmbH' });
    const second = orgClaOpenLabel({ claGroupName: 'Nimbus Foundation CLA', signingEntityName: 'Acme Robotics Ltd' });

    expect(first).toBe('Open Nimbus Foundation CLA, Acme Motors GmbH');
    expect(second).not.toBe(first);
  });

  it('names the agreement alone when the entity is the empty string upstream sends for no entity', () => {
    expect(orgClaOpenLabel({ claGroupName: 'Nimbus Foundation CLA', signingEntityName: '' })).toBe('Open Nimbus Foundation CLA');
  });
});

describe('orgClaCoverageChips', () => {
  it('names the single project, with nothing to open — the chip is already the whole coverage', () => {
    expect(orgClaCoverageChips({ projects: [{ projectName: 'Cascade' }], foundationName: 'Nimbus Foundation' })).toEqual([
      { label: 'Cascade', opensCoverage: false },
    ]);
  });

  it('opens from the count and not from the foundation beside it', () => {
    expect(
      orgClaCoverageChips({
        projects: [{ projectName: 'Cascade' }, { projectName: 'Driftwood' }],
        foundationName: 'Nimbus Foundation',
      })
    ).toEqual([
      { label: 'Nimbus Foundation', opensCoverage: false },
      { label: 'Covers 2 projects', opensCoverage: true },
    ]);
  });

  it('names only the count when several projects have no foundation', () => {
    expect(orgClaCoverageChips({ projects: [{ projectName: 'Cascade' }, { projectName: 'Driftwood' }] })).toEqual([
      { label: 'Covers 2 projects', opensCoverage: true },
    ]);
  });

  it('names the foundation when the project list is empty, opening nothing', () => {
    expect(orgClaCoverageChips({ projects: [], foundationName: 'Nimbus Foundation' })).toEqual([{ label: 'Nimbus Foundation', opensCoverage: false }]);
  });

  it('names nothing when there are no projects and no foundation', () => {
    expect(orgClaCoverageChips({ projects: [] })).toEqual([]);
  });

  // The invariant behind every case above: whatever the row holds, at most one chip is activatable.
  // Two would leave a viewer guessing which opens the list, and the second would open the same one.
  it('never marks more than one chip as opening the list', () => {
    const rows = [
      { projects: [], foundationName: 'Nimbus Foundation' },
      { projects: [{ projectName: 'Cascade' }], foundationName: 'Nimbus Foundation' },
      { projects: [{ projectName: 'Cascade' }, { projectName: 'Driftwood' }], foundationName: 'Nimbus Foundation' },
      { projects: [{ projectName: 'Cascade' }, { projectName: 'Driftwood' }] },
    ];

    for (const row of rows) {
      expect(orgClaCoverageChips(row).filter((chip) => chip.opensCoverage)).toHaveLength(row.projects.length > 1 ? 1 : 0);
    }
  });
});

describe('orgClaCoverageSummary', () => {
  it('names the single project rather than counting it', () => {
    expect(orgClaCoverageSummary({ projects: [{ projectName: 'Cascade' }] })).toBe('Cascade');
  });

  it('counts several projects', () => {
    expect(orgClaCoverageSummary({ projects: [{ projectName: 'Cascade' }, { projectName: 'Driftwood' }] })).toBe('2 projects');
  });

  it('summarises nothing when the agreement names no projects', () => {
    expect(orgClaCoverageSummary({ projects: [] })).toBe('');
  });
});

describe('orgClaPreviewGroup', () => {
  const selection: OrgClaSignSelection = {
    claGroupId: 'cla-group-uuid-1',
    claGroupName: 'Cascade CLA',
    projectSfid: 'a09410000182dD2AAI',
    projectName: 'Cascade',
  };

  it('heads the preview with the CLA Group the picker named, as an agreement nobody has signed', () => {
    expect(orgClaPreviewGroup(selection)).toMatchObject({ claGroupName: 'Cascade CLA', signed: false, status: 'not-started' });
  });

  /**
   * The two fields the signing scope is read from, and the reason this is a function rather than a
   * spread.
   *
   * `projects` holding exactly the entry search named routes the scope through the single-covered-
   * project branch, which returns the SFID search gave. `foundationSfid` staying unset matters
   * because that branch is read *first*: setting it would assert a foundation where search may have
   * named a project, changing the scope the corporate agreement is opened at rather than mislabelling
   * it. Neither is observable from the preview page's own rendering, which is why they are pinned
   * here.
   */
  it('names exactly the one project search resolved, and asserts no foundation', () => {
    const group = orgClaPreviewGroup(selection);

    expect(group.projects).toEqual([{ projectName: 'Cascade', projectSfid: 'a09410000182dD2AAI' }]);
    expect(group.foundationSfid).toBeUndefined();
    expect(group.foundationName).toBeUndefined();
  });

  // 0, not absent. Absence means the deployment did not report a count; this agreement genuinely has
  // none, because it has no signature for them to hang off.
  it('reports no managers and no approval criteria, rather than reporting nothing', () => {
    expect(orgClaPreviewGroup(selection)).toMatchObject({ claManagersCount: 0, approvalCriteriaCount: 0, needsClaManager: false });
  });
});

describe('orgClaGroupForAddress', () => {
  const row = (over: Partial<OrgClaGroup>): OrgClaGroup => ({
    id: 'sig-1',
    claGroupId: 'grp-1',
    claGroupName: 'Nimbus Foundation CLA',
    projects: [{ projectName: 'Cascade', projectSfid: 'a09410000182dD2AAI' }],
    signed: true,
    status: 'signed',
    needsClaManager: false,
    claManagersCount: 0,
    ...over,
  });

  it('finds the group when only one agreement exists for it', () => {
    const groups = [row({}), row({ id: 'sig-9', claGroupId: 'grp-other' })];

    expect(orgClaGroupForAddress(groups, 'grp-1')?.id).toBe('sig-1');
  });

  it('has no answer for a group the organization does not hold', () => {
    expect(orgClaGroupForAddress([row({})], 'grp-absent')).toBeUndefined();
  });

  it('has no answer for an empty address, rather than picking the first row', () => {
    expect(orgClaGroupForAddress([row({})], '')).toBeUndefined();
  });

  /**
   * The case the signature parameter exists for. Two signing entities on one organization hold two
   * agreements at one group id, so the group id alone cannot say which card was clicked. Asserted
   * against the *second* row specifically: a first-match implementation passes the group-id test
   * and fails this one.
   */
  it('opens the named agreement when two signing entities share the group', () => {
    const groups = [
      row({ id: 'sig-a', signingEntityName: 'Acme Motors GmbH', signedOn: '2026-01-01T00:00:00Z' }),
      row({ id: 'sig-b', signingEntityName: 'Acme Robotics Ltd', signedOn: '2026-02-01T00:00:00Z' }),
    ];

    expect(orgClaGroupForAddress(groups, 'grp-1', 'sig-a')?.id).toBe('sig-a');
    expect(orgClaGroupForAddress(groups, 'grp-1', 'sig-b')?.id).toBe('sig-b');
  });

  // A copied link outlives the list it was copied from. Answering a stale signature with the
  // group's current agreement is what the reader wanted; an empty page is not.
  it('falls back to the group when the named signature is no longer in the list', () => {
    const groups = [row({ id: 'sig-a', signedOn: '2026-01-01T00:00:00Z' })];

    expect(orgClaGroupForAddress(groups, 'grp-1', 'sig-gone')?.id).toBe('sig-a');
  });

  // The signature narrows the path; it cannot override it. A signature belonging to another group
  // resolves to the addressed group, not to the signature's own row.
  it('ignores a signature that belongs to a different group', () => {
    const groups = [row({ id: 'sig-a' }), row({ id: 'sig-x', claGroupId: 'grp-other' })];

    expect(orgClaGroupForAddress(groups, 'grp-1', 'sig-x')?.id).toBe('sig-a');
  });

  it('opens the newest signed agreement when no signature is named', () => {
    const groups = [row({ id: 'sig-old', signedOn: '2025-06-01T00:00:00Z' }), row({ id: 'sig-new', signedOn: '2026-02-01T00:00:00Z' })];

    expect(orgClaGroupForAddress(groups, 'grp-1')?.id).toBe('sig-new');
    // Order of arrival must not decide it either.
    expect(orgClaGroupForAddress([...groups].reverse(), 'grp-1')?.id).toBe('sig-new');
  });

  /**
   * `signedOn` is withheld whenever upstream sends no signing timestamp, so "latest date" cannot
   * decide every case and the tiebreak is load-bearing rather than theoretical. Upstream order is
   * deterministic — signing entity, then group name, then group id — so the earlier position wins
   * and the same address resolves the same way on every load.
   */
  it('falls back to upstream order when a candidate carries no signed date', () => {
    const groups = [row({ id: 'sig-first' }), row({ id: 'sig-second' })];

    expect(orgClaGroupForAddress(groups, 'grp-1')?.id).toBe('sig-first');
    expect(orgClaGroupForAddress([...groups].reverse(), 'grp-1')?.id).toBe('sig-second');
  });

  it('falls back to upstream order when two candidates carry the same signed date', () => {
    const groups = [row({ id: 'sig-first', signedOn: '2026-02-01T00:00:00Z' }), row({ id: 'sig-second', signedOn: '2026-02-01T00:00:00Z' })];

    expect(orgClaGroupForAddress(groups, 'grp-1')?.id).toBe('sig-first');
  });

  // A dated row is newer than an undated one, in both arrival orders. Without this, a `0` sentinel
  // for "no date" would read the same for real dates while ranking an unparseable value above a
  // missing one.
  it('prefers a dated agreement over one with no date, whichever arrives first', () => {
    const dated = row({ id: 'sig-dated', signedOn: '2026-02-01T00:00:00Z' });
    const undated = row({ id: 'sig-undated' });

    expect(orgClaGroupForAddress([undated, dated], 'grp-1')?.id).toBe('sig-dated');
    expect(orgClaGroupForAddress([dated, undated], 'grp-1')?.id).toBe('sig-dated');
  });

  it('treats an unparseable signed date as no date rather than as an instant', () => {
    const groups = [row({ id: 'sig-bad', signedOn: 'not-a-date' }), row({ id: 'sig-good', signedOn: '2020-01-01T00:00:00Z' })];

    expect(orgClaGroupForAddress(groups, 'grp-1')?.id).toBe('sig-good');
  });

  /**
   * An unsigned row is a legitimate answer, not something to withhold: the detail page has a
   * not-started view built for it, and hiding it would replace a page explaining how to sign with
   * an empty state.
   */
  it('offers an unsigned row when it is the only one for the group', () => {
    const groups = [row({ id: 'sig-unsigned', signed: false, status: 'not-started', signedOn: undefined })];

    expect(orgClaGroupForAddress(groups, 'grp-1')?.id).toBe('sig-unsigned');
  });

  // It loses the ordering on its own merit rather than by a filter: carrying no signed date, it
  // ranks below any signed sibling. Asserted in both arrival orders so the position cannot be what
  // decides it.
  it('prefers a signed agreement over an unsigned row for the same group', () => {
    const unsigned = row({ id: 'sig-unsigned', signed: false, status: 'not-started', signedOn: undefined });
    const signed = row({ id: 'sig-signed', signedOn: '2026-02-01T00:00:00Z' });

    expect(orgClaGroupForAddress([unsigned, signed], 'grp-1')?.id).toBe('sig-signed');
    expect(orgClaGroupForAddress([signed, unsigned], 'grp-1')?.id).toBe('sig-signed');
  });
});
