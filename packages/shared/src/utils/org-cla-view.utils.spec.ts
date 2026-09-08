// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';

import { orgClaCoverageChips, orgClaCoverageSummary } from './org-cla-view.utils';

describe('orgClaCoverageChips', () => {
  it('names the single project', () => {
    expect(orgClaCoverageChips({ projects: [{ projectName: 'Cascade' }], foundationName: 'Nimbus Foundation' })).toEqual(['Cascade']);
  });

  it('names the foundation and the count when several projects are covered', () => {
    expect(
      orgClaCoverageChips({
        projects: [{ projectName: 'Cascade' }, { projectName: 'Driftwood' }],
        foundationName: 'Nimbus Foundation',
      })
    ).toEqual(['Nimbus Foundation', 'Covers 2 projects']);
  });

  it('names only the count when several projects have no foundation', () => {
    expect(orgClaCoverageChips({ projects: [{ projectName: 'Cascade' }, { projectName: 'Driftwood' }] })).toEqual(['Covers 2 projects']);
  });

  it('names the foundation when the project list is empty', () => {
    expect(orgClaCoverageChips({ projects: [], foundationName: 'Nimbus Foundation' })).toEqual(['Nimbus Foundation']);
  });

  it('names nothing when there are no projects and no foundation', () => {
    expect(orgClaCoverageChips({ projects: [] })).toEqual([]);
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
