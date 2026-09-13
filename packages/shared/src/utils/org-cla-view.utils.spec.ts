// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';

import type { OrgClaSignSelection } from '../interfaces/cla.interface';
import { orgClaCoverageChips, orgClaCoverageSummary, orgClaOpenLabel, orgClaPreviewGroup } from './org-cla-view.utils';

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
