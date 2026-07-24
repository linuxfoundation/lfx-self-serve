// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { beforeEach, describe, expect, it, vi } from 'vitest';

// This layer composes ProjectService/CommitteeService — both mocked wholesale so these tests
// exercise only CreatePickerService's own logic (relation-set selection, direct-grant
// nesting/partitioning, node shaping), not the underlying query-service calls (covered in
// project.service.spec.ts / committee.service.spec.ts).
const { getDirectGrantProjects, getChildProjects, searchCreatableProjects, getProjectsByIds } = vi.hoisted(() => ({
  getDirectGrantProjects: vi.fn(),
  getChildProjects: vi.fn(),
  searchCreatableProjects: vi.fn(),
  getProjectsByIds: vi.fn(),
}));
const { getDirectGrantCommittees, searchCreatableCommittees, getCommittees } = vi.hoisted(() => ({
  getDirectGrantCommittees: vi.fn(),
  searchCreatableCommittees: vi.fn(),
  getCommittees: vi.fn(),
}));

vi.mock('@lfx-one/shared/constants', () => ({ COMMITTEE_WRITE_ARTIFACT_TYPES: ['meeting', 'survey', 'vote'] }));
vi.mock('@lfx-one/shared/utils', () => ({ computeIsFoundation: (project: any) => !!project?.isFoundationStub }));
vi.mock('./project.service', () => ({
  ProjectService: class {
    public getDirectGrantProjects = getDirectGrantProjects;
    public getChildProjects = getChildProjects;
    public searchCreatableProjects = searchCreatableProjects;
    public getProjectsByIds = getProjectsByIds;
  },
}));
vi.mock('./committee.service', () => ({
  CommitteeService: class {
    public getDirectGrantCommittees = getDirectGrantCommittees;
    public searchCreatableCommittees = searchCreatableCommittees;
    public getCommittees = getCommittees;
  },
}));

import type { Request } from 'express';

import { CreatePickerService } from './create-picker.service';

const req = {} as unknown as Request;

function project(uid: string, isFoundation = false) {
  return { uid, name: uid, slug: uid, isFoundationStub: isFoundation };
}

function committee(uid: string, projectUid: string) {
  return { uid, name: uid, project_uid: projectUid, writer: true };
}

describe('CreatePickerService', () => {
  let service: CreatePickerService;

  beforeEach(() => {
    getDirectGrantProjects.mockReset();
    getChildProjects.mockReset();
    searchCreatableProjects.mockReset();
    getProjectsByIds.mockReset();
    getDirectGrantCommittees.mockReset();
    searchCreatableCommittees.mockReset();
    getCommittees.mockReset();

    // Default: every requested project_uid resolves — individual tests override this to exercise
    // the "project couldn't be resolved" omission path.
    getProjectsByIds.mockImplementation((_req: Request, uids: string[] | Set<string>) => {
      const uidArray = Array.from(uids);
      return Promise.resolve(new Map(uidArray.map((uid) => [uid, { uid, slug: uid, name: uid, isFoundationStub: uid === 'foundation-project' }])));
    });

    service = new CreatePickerService();
  });

  describe('getTree', () => {
    it('nests a direct-grant committee under its project instead of listing it top-level', async () => {
      getDirectGrantProjects.mockResolvedValueOnce([project('proj-1')]);
      getDirectGrantCommittees.mockResolvedValueOnce([committee('committee-1', 'proj-1')]);

      const result = await service.getTree(req, 'meeting');

      expect(result.projects.map((p) => p.uid)).toEqual(['proj-1']);
      expect(result.committees).toEqual([]);
    });

    it('surfaces a direct-grant committee as a top-level orphan when its project has no direct grant', async () => {
      getDirectGrantProjects.mockResolvedValueOnce([project('proj-1')]);
      getDirectGrantCommittees.mockResolvedValueOnce([committee('orphan-committee', 'other-project')]);

      const result = await service.getTree(req, 'meeting');

      expect(result.committees.map((c) => c.uid)).toEqual(['orphan-committee']);
    });

    it('skips committee lookups entirely for artifact types that cannot target a committee', async () => {
      getDirectGrantProjects.mockResolvedValueOnce([project('proj-1')]);

      await service.getTree(req, 'newsletter');

      expect(getDirectGrantCommittees).not.toHaveBeenCalled();
    });

    it('requests the meeting_coordinator relation only for the meeting artifact type', async () => {
      getDirectGrantProjects.mockResolvedValue([]);
      getDirectGrantCommittees.mockResolvedValue([]);

      await service.getTree(req, 'meeting');
      expect(getDirectGrantProjects).toHaveBeenLastCalledWith(req, true);

      await service.getTree(req, 'vote');
      expect(getDirectGrantProjects).toHaveBeenLastCalledWith(req, false);
    });

    it('omits a committee whose project cannot be resolved, rather than emitting blank project fields', async () => {
      getDirectGrantProjects.mockResolvedValueOnce([]);
      getDirectGrantCommittees.mockResolvedValueOnce([committee('orphan-unresolvable', 'missing-project')]);
      getProjectsByIds.mockResolvedValueOnce(new Map());

      const result = await service.getTree(req, 'meeting');

      expect(result.committees).toEqual([]);
    });
  });

  describe('getChildren', () => {
    it('fans out a project node into child projects and its committees', async () => {
      getChildProjects.mockResolvedValueOnce([project('child-project')]);
      getCommittees.mockResolvedValueOnce([committee('project-committee', 'parent-uid')]);

      const result = await service.getChildren(req, 'project', 'parent-uid', 'meeting');

      expect(result.projects.map((p) => p.uid)).toEqual(['child-project']);
      expect(result.committees.map((c) => c.uid)).toEqual(['project-committee']);
      expect(getCommittees).toHaveBeenCalledWith(req, { tags: 'project_uid:parent-uid' });
    });

    it('fans out a committee node into child committees only', async () => {
      getCommittees.mockResolvedValueOnce([committee('sub-committee', 'some-project')]);

      const result = await service.getChildren(req, 'committee', 'parent-committee-uid', 'meeting');

      expect(result.projects).toEqual([]);
      expect(result.committees.map((c) => c.uid)).toEqual(['sub-committee']);
      expect(getCommittees).toHaveBeenCalledWith(req, { parent: 'committee:parent-committee-uid' });
      expect(getChildProjects).not.toHaveBeenCalled();
    });

    it('filters out non-writer committees returned by getCommittees', async () => {
      getChildProjects.mockResolvedValueOnce([]);
      getCommittees.mockResolvedValueOnce([{ ...committee('not-writer', 'parent-uid'), writer: false }]);

      const result = await service.getChildren(req, 'project', 'parent-uid', 'meeting');

      expect(result.committees).toEqual([]);
    });

    it('returns nothing for a committee parent when the artifact type disallows committee targets', async () => {
      const result = await service.getChildren(req, 'committee', 'parent-uid', 'newsletter');

      expect(result).toEqual({ projects: [], committees: [] });
      expect(getCommittees).not.toHaveBeenCalled();
    });
  });

  describe('search', () => {
    it('returns only permitted rows across both resource types', async () => {
      searchCreatableProjects.mockResolvedValueOnce([project('found-project')]);
      searchCreatableCommittees.mockResolvedValueOnce([committee('found-committee', 'some-project')]);

      const result = await service.search(req, 'kubernetes', 'meeting');

      expect(result.projects.map((p) => p.uid)).toEqual(['found-project']);
      expect(result.committees.map((c) => c.uid)).toEqual(['found-committee']);
    });
  });
});
