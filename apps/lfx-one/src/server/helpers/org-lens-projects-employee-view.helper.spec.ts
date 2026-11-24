// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import '@angular/compiler';

import type { OrgLensProject, OrgLensProjectsResponse, OrgProjectsWorkspacesResponse } from '@lfx-one/shared/interfaces';
import type { Request } from 'express';
import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ getOrgLensViewMode: vi.fn() }));
vi.mock('./org-lens-read-access.helper', () => ({ getOrgLensViewMode: mocks.getOrgLensViewMode }));

const { redactProjectsForEmployeeView, redactWorkspacesForEmployeeView } = await import('./org-lens-projects-employee-view.helper');

const req = {} as Request;
const person = (id: string, name: string) => ({ id, name, avatarUrl: `https://avatars.example/${id}.png` });

const project = {
  slug: 'kubernetes',
  name: 'Kubernetes',
  maintainers: [person('m1', 'Ada Lovelace')],
  contributors: [person('c1', 'Grace Hopper'), person('c2', 'Linus T')],
  participants: [person('p1', 'Alan Turing')],
  commits1y: 42,
} as unknown as OrgLensProject;

const response = { orgSlug: 'acme', orgName: 'Acme', dataUpdatedAt: '2026-11-01T00:00:00Z', projects: [project] } as OrgLensProjectsResponse;

describe('redactProjectsForEmployeeView', () => {
  it('leaves the full view payload untouched', () => {
    mocks.getOrgLensViewMode.mockReturnValue('full');

    expect(redactProjectsForEmployeeView(req, 'org', response)).toBe(response);
  });

  it('removes every name, member id and avatar in the employee view but keeps the counts and company-level fields', () => {
    mocks.getOrgLensViewMode.mockReturnValue('employee');

    const result = redactProjectsForEmployeeView(req, 'org', response);
    const [row] = result.projects;

    expect(row.maintainers).toHaveLength(1);
    expect(row.contributors).toHaveLength(2);
    expect(row.participants).toHaveLength(1);
    expect(row.name).toBe('Kubernetes');
    expect(row.commits1y).toBe(42);
    expect(result.orgName).toBe('Acme');

    const serialized = JSON.stringify(result);
    for (const leaked of ['Ada Lovelace', 'Grace Hopper', 'Linus T', 'Alan Turing', 'avatars.example', '"m1"', '"c1"', '"p1"']) {
      expect(serialized).not.toContain(leaked);
    }
  });

  it('does not mutate the source response (it may be a cached object)', () => {
    mocks.getOrgLensViewMode.mockReturnValue('employee');

    redactProjectsForEmployeeView(req, 'org', response);

    expect(project.contributors[0].name).toBe('Grace Hopper');
  });
});

describe('redactWorkspacesForEmployeeView', () => {
  const workspaces = {
    workspaces: [
      { id: 'all-activities', name: 'All Projects with Activities', projectSlugs: [] },
      { id: 'w1', name: 'Ada Lovelace focus', projectSlugs: ['kubernetes', 'envoy'] },
      { id: 'w2', name: 'ada@acme.example', projectSlugs: ['helm'] },
    ],
  } as OrgProjectsWorkspacesResponse;

  it('leaves the full view payload untouched', () => {
    mocks.getOrgLensViewMode.mockReturnValue('full');

    expect(redactWorkspacesForEmployeeView(req, 'org', workspaces)).toBe(workspaces);
  });

  it('replaces user-typed workspace names in the employee view and keeps ids, slugs and the default name', () => {
    mocks.getOrgLensViewMode.mockReturnValue('employee');

    expect(redactWorkspacesForEmployeeView(req, 'org', workspaces).workspaces).toEqual([
      { id: 'all-activities', name: 'All Projects with Activities', projectSlugs: [] },
      { id: 'w1', name: 'Workspace 1', projectSlugs: ['kubernetes', 'envoy'] },
      { id: 'w2', name: 'Workspace 2', projectSlugs: ['helm'] },
    ]);
  });
});
