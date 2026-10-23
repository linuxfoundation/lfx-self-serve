// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Request } from 'express';
import { CommitteeMemberRole, CommitteeMemberStatus } from '@lfx-one/shared/enums/committee-member.enum';

const mocks = vi.hoisted(() => ({
  settings: vi.fn(),
  subject: vi.fn(),
  committees: vi.fn(),
  members: vi.fn(),
  warning: vi.fn(),
}));
vi.mock('./project.service', () => ({
  ProjectService: class {
    public getProjectSettings = mocks.settings;
    public resolveEmailToSub = mocks.subject;
  },
}));
vi.mock('./committee.service', () => ({
  CommitteeService: class {
    public getCommittees = mocks.committees;
    public getCommitteeMembers = mocks.members;
  },
}));
vi.mock('./logger.service', () => ({ logger: { warning: mocks.warning } }));

import { MicroserviceError, ResourceNotFoundError } from '../errors';
import { MktgProjectRolesService } from './mktg-project-roles.service';

const project = 'synthetic-project';
const committee = { uid: 'synthetic-toc', project_uid: project, category: 'Technical Oversight Committee' };
const chair = {
  uid: 'synthetic-member',
  committee_uid: committee.uid,
  first_name: 'TOC',
  last_name: 'chair',
  email: 'chair@example.test',
  username: 'synthetic-chair',
  status: CommitteeMemberStatus.ACTIVE,
  role: { name: CommitteeMemberRole.CHAIR },
};

describe('MktgProjectRolesService', () => {
  let service: MktgProjectRolesService;
  let req: Request;
  beforeEach(() => {
    vi.resetAllMocks();
    service = new MktgProjectRolesService();
    req = {} as Request;
    mocks.settings.mockResolvedValue({ executive_director: { name: 'Executive director', email: 'ed@example.test', username: 'synthetic-ed' } });
    mocks.subject.mockImplementation(async (_req: Request, email: string) => (email === 'ed@example.test' ? 'auth0|opaque-ed' : 'auth0|opaque-chair'));
    mocks.committees.mockResolvedValue([committee]);
    mocks.members.mockResolvedValue([chair]);
  });

  it('resolves display names and directory subjects from existing services, not usernames or invented IDs', async () => {
    expect(await service.rolesOf(req, project)).toEqual({
      ed: { name: 'Executive director', subject: 'auth0|opaque-ed' },
      tocChair: { name: 'TOC chair', subject: 'auth0|opaque-chair' },
    });
    expect(mocks.settings).toHaveBeenCalledWith(req, project);
    expect(mocks.committees).toHaveBeenCalledWith(req, { tags: `project_uid:${project}` }, { skipMailingListEnrichment: true });
    expect(mocks.members).toHaveBeenCalledWith(req, committee.uid, { require_complete: 'true' });
    expect(mocks.subject).toHaveBeenCalledWith(req, chair.email);
    expect(JSON.stringify(await service.rolesOf(req, project))).not.toContain('@');
    expect(JSON.stringify(await service.rolesOf(req, project))).not.toContain('synthetic-chair');
  });

  it('coalesces concurrent calls for one request and project', async () => {
    const first = service.rolesOf(req, project);
    const second = service.rolesOf(req, project);
    expect(first).toBe(second);
    await Promise.all([first, second]);
    expect(mocks.settings).toHaveBeenCalledTimes(1);
    expect(mocks.committees).toHaveBeenCalledTimes(1);
    expect(mocks.members).toHaveBeenCalledTimes(1);
    expect(mocks.subject).toHaveBeenCalledTimes(2);
  });

  it('does not reuse a cached roster across requests or projects', async () => {
    await service.rolesOf(req, project);
    await service.rolesOf({} as Request, project);
    await service.rolesOf(req, 'other-project');
    expect(mocks.settings).toHaveBeenCalledTimes(3);
    expect(mocks.settings).toHaveBeenLastCalledWith(req, 'other-project');
    expect(mocks.committees).toHaveBeenCalledTimes(3);
    expect(mocks.members).toHaveBeenCalledTimes(2); // The other project's query may not select this project's committee.
  });

  it('does not invent an ED when settings have no assignment', async () => {
    mocks.settings.mockResolvedValue({ executive_director: null });
    expect((await service.rolesOf(req, project)).ed).toBeNull();
    expect(mocks.subject).not.toHaveBeenCalledWith(req, 'ed@example.test');
  });

  it('leaves a person without email unresolved, with no username fallback', async () => {
    mocks.settings.mockResolvedValue({ executive_director: { name: 'Executive director', username: 'synthetic-ed' } });
    mocks.members.mockResolvedValue([{ ...chair, email: '' }]);
    expect(await service.rolesOf(req, project)).toEqual({
      ed: { name: 'Executive director', subject: null },
      tocChair: { name: 'TOC chair', subject: null },
    });
    expect(mocks.subject).not.toHaveBeenCalled();
  });

  it.each([new ResourceNotFoundError('User'), new MicroserviceError('ed@example.test', 503, 'UNAVAILABLE')])(
    'fails closed on a typed subject lookup failure without logging its raw address',
    async (error) => {
      mocks.subject.mockRejectedValue(error);
      const roles = await service.rolesOf(req, project);
      expect(roles.ed?.subject).toBeNull();
      expect(roles.tocChair?.subject).toBeNull();
      expect(mocks.warning).toHaveBeenCalledTimes(2);
      const logged = JSON.stringify(mocks.warning.mock.calls);
      expect(logged).not.toContain('ed@example.test');
      expect(logged).not.toContain('chair@example.test');
      expect(logged).toContain('tocChair');
    }
  );

  it('does not treat an empty subject reply as a usable identity', async () => {
    mocks.subject.mockResolvedValue(' ');
    const roles = await service.rolesOf(req, project);
    expect(roles.ed?.subject).toBeNull();
    expect(roles.tocChair?.subject).toBeNull();
  });

  it.each([
    [],
    [{ ...committee, category: 'Technical Steering Committee' }],
    [{ ...committee, project_uid: 'foreign-project' }],
    [committee, { ...committee, uid: 'second-toc' }],
  ])('refuses an absent or ambiguous exact-project TOC', async (committees) => {
    mocks.committees.mockResolvedValue(committees);
    expect((await service.rolesOf(req, project)).tocChair).toBeNull();
    expect(mocks.members).not.toHaveBeenCalled();
  });

  it.each([CommitteeMemberRole.CHAIR, CommitteeMemberRole.VICE_CHAIR])('provisionally includes the active %s role', async (name) => {
    mocks.members.mockResolvedValue([{ ...chair, role: { name } }]);
    expect((await service.rolesOf(req, project)).tocChair?.subject).toBe('auth0|opaque-chair');
  });

  it.each([
    [{ ...chair, status: CommitteeMemberStatus.INACTIVE }],
    [{ ...chair, role: { name: CommitteeMemberRole.NONE } }],
    [{ ...chair, role: null }],
    [{ ...chair, committee_uid: 'foreign-committee' }],
    [chair, { ...chair, uid: 'second-chair' }],
  ])('leaves an ineligible or multiple-chair roster unresolved', async (members) => {
    mocks.members.mockResolvedValue(members);
    expect((await service.rolesOf(req, project)).tocChair).toBeNull();
    expect(mocks.subject).not.toHaveBeenCalledWith(req, chair.email);
  });

  it('does not pick a chair from a failed complete roster read', async () => {
    mocks.members.mockRejectedValue(new MicroserviceError('later page failed', 502, 'BAD_GATEWAY'));
    const roles = await service.rolesOf(req, project);
    expect(roles.tocChair).toBeNull();
    expect(roles.ed?.subject).toBe('auth0|opaque-ed');
    expect(mocks.warning).toHaveBeenCalledWith(req, 'mktg_project_roles_read', 'TOC chair roster is unresolved', { role: 'tocChair', code: 'BAD_GATEWAY' });
  });

  it('isolates typed source failures while keeping the other role readable', async () => {
    mocks.settings.mockRejectedValue(new MicroserviceError('unavailable', 503, 'UNAVAILABLE'));
    expect((await service.rolesOf(req, project)).ed).toBeNull();
    expect((await service.rolesOf(req, project)).tocChair?.subject).toBe('auth0|opaque-chair');
    expect(mocks.warning).toHaveBeenCalledTimes(1);
  });

  it('validates the project before any source lookup', () => {
    expect(() => service.rolesOf(req, '../unsafe')).toThrow();
    expect(mocks.settings).not.toHaveBeenCalled();
    expect(mocks.committees).not.toHaveBeenCalled();
  });
});
