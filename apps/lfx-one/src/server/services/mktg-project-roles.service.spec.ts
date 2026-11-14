// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Request } from 'express';
import { CommitteeMemberRole, CommitteeMemberStatus, CommitteeMemberVisibility } from '@lfx-one/shared/enums';

const mocks = vi.hoisted(() => ({
  settings: vi.fn(),
  subject: vi.fn(),
  committees: vi.fn(),
  members: vi.fn(),
  detail: vi.fn(),
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
    public getCommitteeById = mocks.detail;
  },
}));
vi.mock('@lfx-one/shared/constants', async () => ({
  ...(await vi.importActual<object>('../../../../../packages/shared/src/constants/committees.constants')),
  ...(await vi.importActual<object>('../../../../../packages/shared/src/constants/mktg-artifact.constants')),
  ...(await vi.importActual<object>('../../../../../packages/shared/src/constants/mktg-project-roles.constants')),
}));
vi.mock('@lfx-one/shared/utils', async () => ({
  ...(await vi.importActual<object>('../../../../../packages/shared/src/utils/committee.utils')),
  ...(await vi.importActual<object>('../../../../../packages/shared/src/utils/email.utils')),
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
    mocks.detail.mockResolvedValue({ ...committee, member_visibility: CommitteeMemberVisibility.BASIC_PROFILE });
  });

  it('resolves opaque identity independently from request-local display names and usernames', async () => {
    expect(await service.rolesOf(req, project)).toEqual({
      ed: { name: 'Executive director', username: 'synthetic-ed', subject: 'auth0|opaque-ed' },
      tocChair: { name: 'TOC chair', username: 'synthetic-chair', subject: 'auth0|opaque-chair' },
    });
    expect(mocks.settings).toHaveBeenCalledWith(req, project);
    expect(mocks.committees).toHaveBeenCalledWith(req, { tags: `project_uid:${project}` }, { skipMailingListEnrichment: true, requireComplete: true });
    expect(mocks.members).toHaveBeenCalledWith(req, committee.uid, { require_complete: 'true' });
    expect(mocks.subject).toHaveBeenCalledWith(req, chair.email);
    expect(JSON.stringify(await service.rolesOf(req, project))).not.toContain('@');
    expect(mocks.detail).toHaveBeenCalledWith(req, committee.uid, { includeAuditor: true });
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
      ed: { name: 'Executive director', username: 'synthetic-ed', subject: null },
      tocChair: { name: 'TOC chair', username: 'synthetic-chair', subject: null },
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
    { committees: [] },
    { committees: [{ ...committee, category: 'Technical Steering Committee' }] },
    { committees: [{ ...committee, project_uid: 'foreign-project' }] },
    { committees: [committee, { ...committee, uid: 'second-toc' }] },
  ])('refuses an absent or ambiguous exact-project TOC', async ({ committees }) => {
    mocks.committees.mockResolvedValue(committees);
    expect((await service.rolesOf(req, project)).tocChair).toBeNull();
    expect(mocks.members).not.toHaveBeenCalled();
  });

  it.each([CommitteeMemberRole.CHAIR, CommitteeMemberRole.VICE_CHAIR])('provisionally includes the active %s role', async (name) => {
    mocks.members.mockResolvedValue([{ ...chair, role: { name } }]);
    expect((await service.rolesOf(req, project)).tocChair?.subject).toBe('auth0|opaque-chair');
  });

  it.each([
    { members: [{ ...chair, status: CommitteeMemberStatus.INACTIVE }] },
    { members: [{ ...chair, role: { name: CommitteeMemberRole.NONE } }] },
    { members: [{ ...chair, role: null }] },
    { members: [{ ...chair, committee_uid: 'foreign-committee' }] },
    { members: [chair, { ...chair, uid: 'second-chair' }] },
    {
      members: [
        { ...chair, role: { name: CommitteeMemberRole.VICE_CHAIR } },
        { ...chair, uid: 'second-vice', role: { name: CommitteeMemberRole.VICE_CHAIR } },
      ],
    },
  ])('leaves an ineligible or multiple-chair roster unresolved', async ({ members }) => {
    mocks.members.mockResolvedValue(members);
    expect((await service.rolesOf(req, project)).tocChair).toBeNull();
    expect(mocks.subject).not.toHaveBeenCalledWith(req, chair.email);
  });

  it('prefers the unique active Chair when a Vice Chair is also active', async () => {
    mocks.members.mockResolvedValue([chair, { ...chair, uid: 'vice', email: 'vice@example.test', role: { name: CommitteeMemberRole.VICE_CHAIR } }]);
    expect((await service.rolesOf(req, project)).tocChair?.username).toBe('synthetic-chair');
    expect(mocks.subject).not.toHaveBeenCalledWith(req, 'vice@example.test');
  });

  it.each([
    { start: '2026-01-01', end: '2026-10-23', vice: true },
    { start: undefined, end: '2026-10-24T12:00:00Z', vice: true },
    { start: '2026-10-24T12:00:00.001Z', end: undefined, vice: true },
    { start: '2026-10-24T12:00:00Z', end: '2026-10-25', vice: false },
    { start: undefined, end: undefined, vice: false },
    { start: undefined, end: '2026-10-25', vice: false },
    { start: '2026-01-01', end: undefined, vice: false },
    { start: 'invalid-date', end: undefined, vice: true },
  ])('filters role terms before precedence (start=$start,end=$end,vice=$vice)', async ({ start, end, vice }) => {
    const clock = vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-10-24T12:00:00Z'));
    try {
      mocks.members.mockResolvedValue([
        { ...chair, role: { name: CommitteeMemberRole.CHAIR, start_date: start, end_date: end } },
        {
          ...chair,
          uid: 'vice',
          username: 'synthetic-vice',
          email: 'vice@example.test',
          role: { name: CommitteeMemberRole.VICE_CHAIR, start_date: '2026-01-01', end_date: '2027-01-01' },
        },
      ]);
      expect((await service.rolesOf(req, project)).tocChair?.username).toBe(vice ? 'synthetic-vice' : 'synthetic-chair');
    } finally {
      clock.mockRestore();
    }
  });

  it.each([
    { member_visibility: CommitteeMemberVisibility.HIDDEN, writer: false, auditor: false, display: false },
    { member_visibility: undefined, writer: false, auditor: false, display: false },
    { member_visibility: CommitteeMemberVisibility.HIDDEN, writer: true, auditor: false, display: true },
    { member_visibility: CommitteeMemberVisibility.HIDDEN, writer: false, auditor: true, display: true },
    { member_visibility: CommitteeMemberVisibility.BASIC_PROFILE, writer: false, auditor: false, display: true },
  ])('gates display fields by authoritative roster visibility, never the opaque subject: %j', async ({ display, ...visibility }) => {
    mocks.detail.mockResolvedValue({ ...committee, ...visibility });
    const person = (await service.rolesOf(req, project)).tocChair;
    expect(person?.subject).toBe('auth0|opaque-chair');
    expect(person?.name).toBe(display ? 'TOC chair' : null);
    expect(person?.username).toBe(display ? 'synthetic-chair' : undefined);
  });

  it('hides display fields if the visibility lookup fails but retains the resolved subject', async () => {
    mocks.detail.mockRejectedValue(new MicroserviceError('Unavailable', 503, 'UNAVAILABLE'));
    expect((await service.rolesOf(req, project)).tocChair).toEqual({ name: null, subject: 'auth0|opaque-chair' });
  });

  it('does not infer a unique TOC from a failed complete committee listing', async () => {
    mocks.committees.mockRejectedValue(new MicroserviceError('Later list page failed', 502, 'BAD_GATEWAY'));
    expect((await service.rolesOf(req, project)).tocChair).toBeNull();
    expect(mocks.members).not.toHaveBeenCalled();
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

  it('rejects an invalid project before any source lookup', async () => {
    await expect(service.rolesOf(req, '../unsafe')).rejects.toThrow();
    expect(mocks.settings).not.toHaveBeenCalled();
    expect(mocks.committees).not.toHaveBeenCalled();
  });
});
