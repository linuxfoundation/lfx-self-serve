// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import '@angular/compiler';

import { MENTORSHIP_LF_PROJECT_PAGE_SIZE } from '@lfx-one/shared/constants';
import type { Request } from 'express';
import { beforeEach, describe, expect, it, vi, afterEach, type MockInstance } from 'vitest';

import { MENTORSHIP_ADMIN_SEARCH_MAX_LENGTH, MENTORSHIP_LF_PROJECT_MAX_LIMIT, MENTORSHIP_LF_PROJECT_MAX_READS } from '../constants';
import { MicroserviceError } from '../errors';

// The service resolves its request-scoped logger through this module; stubbing it here
// avoids booting the real pino instance for a synchronous, in-memory lookup path.
vi.mock('./logger.service', () => ({
  logger: {
    startOperation: vi.fn(() => 0),
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
    debug: vi.fn(),
    info: vi.fn(),
  },
}));

const { MentorshipService } = await import('./mentorship.service');
const { MicroserviceProxyService } = await import('./microservice-proxy.service');
const { EmailVerificationService } = await import('./email-verification.service');
const { logger } = await import('./logger.service');

function buildReq(): Request {
  return { path: '/api/mentorship/program-review/x' } as Request;
}

describe('MentorshipService program review', () => {
  const programId = '6f1c2d3e-4a5b-4c6d-8e7f-9a0b1c2d3e4f';
  const upstreamProgram = {
    id: programId,
    name: 'Test Program',
    slug: 'test-program',
    status: 'pending',
    is_paid: false,
    created_on: '2026-09-01T00:00:00Z',
    updated_on: '2026-09-01T00:00:00Z',
  };
  let service: InstanceType<typeof MentorshipService>;
  let proxyRequest: MockInstance<InstanceType<typeof MicroserviceProxyService>['proxyRequest']>;

  beforeEach(() => {
    proxyRequest = vi.spyOn(MicroserviceProxyService.prototype, 'proxyRequest');
    service = new MentorshipService();
  });

  afterEach(() => {
    proxyRequest.mockRestore();
  });

  it('reads the program from the mentorship service and returns only the review fields', async () => {
    proxyRequest.mockResolvedValue(upstreamProgram);

    const review = await service.getProgramReview(buildReq(), programId);

    expect(proxyRequest).toHaveBeenCalledWith(expect.anything(), 'LFX_V2_SERVICE', `/mentorship/v1/programs/${programId}`, 'GET');
    expect(review).toEqual({ id: programId, name: 'Test Program', status: 'pending' });
  });

  it.each([
    ['approve', 'published'],
    ['reject', 'rejected'],
  ] as const)('maps the %s decision to the upstream %s status', async (decision, status) => {
    proxyRequest.mockResolvedValue({ ...upstreamProgram, status });

    const review = await service.submitProgramDecision(buildReq(), programId, decision);

    expect(proxyRequest).toHaveBeenCalledWith(expect.anything(), 'LFX_V2_SERVICE', `/mentorship/v1/programs/${programId}/decision`, 'POST', undefined, {
      status,
    });
    expect(review).toEqual({ id: programId, name: 'Test Program', status });
  });

  it('lets an upstream error through so its status reaches the page', async () => {
    const forbidden = Object.assign(new Error('forbidden'), { statusCode: 403 });
    proxyRequest.mockRejectedValue(forbidden);

    await expect(service.submitProgramDecision(buildReq(), programId, 'approve')).rejects.toBe(forbidden);
  });
});

describe('MentorshipService enroll name availability', () => {
  let service: InstanceType<typeof MentorshipService>;
  let proxyRequest: MockInstance<InstanceType<typeof MicroserviceProxyService>['proxyRequest']>;

  beforeEach(() => {
    proxyRequest = vi.spyOn(MicroserviceProxyService.prototype, 'proxyRequest');
    service = new MentorshipService();
  });

  afterEach(() => {
    proxyRequest.mockRestore();
    vi.clearAllMocks();
  });

  it.each([true, false])('sends the trimmed name upstream and passes available=%s through', async (available) => {
    proxyRequest.mockResolvedValue({ available });

    const result = await service.isProgramNameAvailable(buildReq(), '  Secret Program Name  ');

    expect(proxyRequest).toHaveBeenCalledWith(
      expect.anything(),
      'LFX_V2_SERVICE',
      '/mentorship/v1/programs/name-availability',
      'GET',
      {
        name: 'Secret Program Name',
      },
      undefined
    );
    expect(result).toEqual({ available });
  });

  it('asks upstream to leave out an edited program', async () => {
    proxyRequest.mockResolvedValue({ available: true });

    await service.isProgramNameAvailable(buildReq(), 'Program', 'program-uuid');

    expect(proxyRequest).toHaveBeenCalledWith(
      expect.anything(),
      'LFX_V2_SERVICE',
      '/mentorship/v1/programs/name-availability',
      'GET',
      { name: 'Program', exclude_program_id: 'program-uuid' },
      undefined
    );
  });

  it('never logs the program name', async () => {
    proxyRequest.mockResolvedValue({ available: true });

    await service.isProgramNameAvailable(buildReq(), 'Secret Program Name');

    expect(JSON.stringify(vi.mocked(logger.debug).mock.calls)).not.toContain('Secret Program Name');
  });

  it('lets an upstream failure reject', async () => {
    const failure = Object.assign(new Error('boom'), { statusCode: 500 });
    proxyRequest.mockRejectedValue(failure);

    await expect(service.isProgramNameAvailable(buildReq(), 'Program')).rejects.toBe(failure);
  });

  it('cuts the query, and so the name, out of the logged path of a failed check', async () => {
    proxyRequest.mockRejectedValue(
      new MicroserviceError('Upstream unavailable', 503, 'NETWORK_ERROR', {
        service: 'api_client_service',
        path: 'https://upstream.example/mentorship/v1/programs/name-availability?name=Secret+Program+Name',
        transportFailure: true,
      })
    );

    const error = await service.isProgramNameAvailable(buildReq(), 'Secret Program Name').catch((e: unknown) => e);

    expect(error).toBeInstanceOf(MicroserviceError);
    expect(error).toMatchObject({
      message: 'Upstream unavailable',
      statusCode: 503,
      code: 'NETWORK_ERROR',
      transportFailure: true,
      path: 'https://upstream.example/mentorship/v1/programs/name-availability',
    });
    expect(JSON.stringify((error as MicroserviceError).getLogContext())).not.toContain('Secret');
  });
});

describe('MentorshipService LF project search', () => {
  let service: InstanceType<typeof MentorshipService>;
  let proxyRequest: MockInstance<InstanceType<typeof MicroserviceProxyService>['proxyRequest']>;

  const project = (uid: string, name: string, logoUrl = '') => ({ uid, name, slug: `${name.toLowerCase()}-slug`, logo_url: logoUrl });
  const page = (projects: ReturnType<typeof project>[], pageToken?: string) => ({
    resources: projects.map((data) => ({ type: 'project', id: data.uid, data })),
    ...(pageToken ? { page_token: pageToken } : {}),
  });

  beforeEach(() => {
    proxyRequest = vi.spyOn(MicroserviceProxyService.prototype, 'proxyRequest');
    service = new MentorshipService();
  });

  afterEach(() => {
    proxyRequest.mockRestore();
  });

  it.each(['', '   ', undefined])('lists projects by name, without ROOT, for search %j', async (search) => {
    proxyRequest.mockResolvedValue(page([{ ...project('uid-root', 'Root'), slug: 'ROOT' }, project('uid-1', 'Alpha')]));

    const result = await service.getLfProjects(buildReq(), { search });

    expect(proxyRequest).toHaveBeenCalledWith(expect.anything(), 'LFX_V2_SERVICE', '/query/resources', 'GET', {
      type: 'project',
      sort: 'name_asc',
      page_size: MENTORSHIP_LF_PROJECT_PAGE_SIZE,
    });
    expect(result).toEqual({ data: [{ id: 'uid-1', name: 'Alpha', slug: 'alpha-slug' }] });
  });

  it('searches by relevance when a term is typed', async () => {
    proxyRequest.mockResolvedValue(page([project('uid-1', 'Alpha')]));

    await service.getLfProjects(buildReq(), { search: ' alp ', limit: 5 });

    expect(proxyRequest).toHaveBeenCalledWith(expect.anything(), 'LFX_V2_SERVICE', '/query/resources', 'GET', {
      type: 'project',
      name: 'alp',
      sort: 'best_match',
      page_size: 5,
    });
  });

  it('resumes from the page token it is given', async () => {
    proxyRequest.mockResolvedValue(page([project('uid-1', 'Alpha')]));

    await service.getLfProjects(buildReq(), { pageToken: 'cursor-2', limit: 1 });

    expect(proxyRequest).toHaveBeenCalledWith(expect.anything(), 'LFX_V2_SERVICE', '/query/resources', 'GET', {
      type: 'project',
      sort: 'name_asc',
      page_size: 1,
      page_token: 'cursor-2',
    });
  });

  it('follows the page token while a page comes back short, asking only for the slots still open, and returns the token it stopped at', async () => {
    proxyRequest.mockResolvedValueOnce(page([project('uid-1', 'Alpha')], 'cursor-2')).mockResolvedValueOnce(page([project('uid-2', 'Beta')], 'cursor-3'));

    const result = await service.getLfProjects(buildReq(), { limit: 2 });

    expect(proxyRequest).toHaveBeenCalledTimes(2);
    expect(proxyRequest).toHaveBeenLastCalledWith(expect.anything(), 'LFX_V2_SERVICE', '/query/resources', 'GET', {
      type: 'project',
      sort: 'name_asc',
      page_size: 1,
      page_token: 'cursor-2',
    });
    expect(result).toEqual({
      data: [
        { id: 'uid-1', name: 'Alpha', slug: 'alpha-slug' },
        { id: 'uid-2', name: 'Beta', slug: 'beta-slug' },
      ],
      page_token: 'cursor-3',
    });
  });

  it('never returns more projects than the page size across refill reads', async () => {
    const projects = (from: number, count: number) => Array.from({ length: count }, (_, i) => project(`uid-${from + i}`, `Project${from + i}`));
    proxyRequest
      .mockResolvedValueOnce(page(projects(1, 11), 'cursor-2'))
      .mockImplementationOnce(async (_req, _service, _path, _method, query) =>
        page(projects(12, Number((query as { page_size: number }).page_size)), 'cursor-3')
      );

    const result = await service.getLfProjects(buildReq(), { limit: 12 });

    expect(proxyRequest.mock.calls.map((call) => (call[4] as { page_size: number }).page_size)).toEqual([12, 1]);
    expect(result.data).toHaveLength(12);
    expect(result.page_token).toBe('cursor-3');
  });

  it('stops after MENTORSHIP_LF_PROJECT_MAX_READS reads and hands the cursor back', async () => {
    let reads = 0;
    proxyRequest.mockImplementation(async () => page([], `cursor-${++reads}`));

    const result = await service.getLfProjects(buildReq(), { limit: 10 });

    expect(proxyRequest).toHaveBeenCalledTimes(MENTORSHIP_LF_PROJECT_MAX_READS);
    expect(result).toEqual({ data: [], page_token: `cursor-${MENTORSHIP_LF_PROJECT_MAX_READS}` });
  });

  it('ends the list instead of replaying a page whose cursor comes back unchanged', async () => {
    proxyRequest.mockResolvedValueOnce(page([project('uid-1', 'Alpha')], 'cursor-x')).mockResolvedValueOnce(page([project('uid-2', 'Beta')], 'cursor-x'));

    const result = await service.getLfProjects(buildReq(), { limit: 10 });

    expect(proxyRequest).toHaveBeenCalledTimes(2);
    expect(result).toEqual({
      data: [
        { id: 'uid-1', name: 'Alpha', slug: 'alpha-slug' },
        { id: 'uid-2', name: 'Beta', slug: 'beta-slug' },
      ],
    });
  });

  it.each([
    [0, 1],
    [-5, 1],
    [100_000, MENTORSHIP_LF_PROJECT_MAX_LIMIT],
  ])('holds a requested limit of %d to a page_size of %d', async (limit, pageSize) => {
    proxyRequest.mockResolvedValue(page([project('uid-1', 'Alpha')]));

    await service.getLfProjects(buildReq(), { limit });

    expect(proxyRequest).toHaveBeenCalledWith(expect.anything(), 'LFX_V2_SERVICE', '/query/resources', 'GET', {
      type: 'project',
      sort: 'name_asc',
      page_size: pageSize,
    });
  });

  it('cuts an overlong search to MENTORSHIP_ADMIN_SEARCH_MAX_LENGTH', async () => {
    proxyRequest.mockResolvedValue(page([]));

    await service.getLfProjects(buildReq(), { search: 'a'.repeat(MENTORSHIP_ADMIN_SEARCH_MAX_LENGTH + 50) });

    expect(proxyRequest).toHaveBeenCalledWith(
      expect.anything(),
      'LFX_V2_SERVICE',
      '/query/resources',
      'GET',
      expect.objectContaining({ name: 'a'.repeat(MENTORSHIP_ADMIN_SEARCH_MAX_LENGTH) })
    );
  });

  it('cuts an overlong search without splitting an emoji at the boundary', async () => {
    proxyRequest.mockResolvedValue(page([]));

    await service.getLfProjects(buildReq(), { search: `${'a'.repeat(MENTORSHIP_ADMIN_SEARCH_MAX_LENGTH - 1)}😀tail` });

    expect(proxyRequest).toHaveBeenCalledWith(
      expect.anything(),
      'LFX_V2_SERVICE',
      '/query/resources',
      'GET',
      expect.objectContaining({ name: 'a'.repeat(MENTORSHIP_ADMIN_SEARCH_MAX_LENGTH - 1) })
    );
  });

  it('maps a logo when present and omits an empty one', async () => {
    proxyRequest.mockResolvedValue(page([project('uid-1', 'Alpha', 'https://cdn.example/alpha.png'), project('uid-2', 'Beta')]));

    const result = await service.getLfProjects(buildReq(), { search: 'a' });

    expect(result.data).toEqual([
      { id: 'uid-1', name: 'Alpha', slug: 'alpha-slug', logoUrl: 'https://cdn.example/alpha.png' },
      { id: 'uid-2', name: 'Beta', slug: 'beta-slug' },
    ]);
    expect(result.data[1]).not.toHaveProperty('logoUrl');
  });

  it('lets a query-service failure reject', async () => {
    const failure = new Error('query service down');
    proxyRequest.mockRejectedValue(failure);

    await expect(service.getLfProjects(buildReq(), { search: 'a' })).rejects.toBe(failure);
  });
});

describe('MentorshipService LFX profile sync', () => {
  const fields = { firstName: 'Test' };
  const body = { first_name: 'Test', email: 'test.user@example.com' };
  const mentorRow = { data: [{ id: 'profile-mentor-1', profile_type: 'mentor' }], meta: { total: 1 } };
  let service: InstanceType<typeof MentorshipService>;
  let proxyRequest: MockInstance<InstanceType<typeof MicroserviceProxyService>['proxyRequest']>;
  let getUserEmails: MockInstance<InstanceType<typeof EmailVerificationService>['getUserEmails']>;
  let listIdentitiesSafe: MockInstance<InstanceType<typeof EmailVerificationService>['listIdentitiesSafe']>;
  const githubIdentity = { provider: 'github', user_id: 'github-1', connection: 'github', isSocial: true, profileData: { nickname: 'test-user' } };

  function signedInReq(): Request {
    return { path: '/api/mentorship/me/lfx-profile', impersonationActive: false, oidc: { user: { sub: 'auth0|test-user-1' } } } as unknown as Request;
  }

  beforeEach(() => {
    proxyRequest = vi.spyOn(MicroserviceProxyService.prototype, 'proxyRequest');
    getUserEmails = vi.spyOn(EmailVerificationService.prototype, 'getUserEmails').mockResolvedValue({
      primary_email: 'test.user@example.com',
      alternate_emails: [],
    });
    // No GitHub account by default, so the specs that are not about the link send no `profile_links`.
    listIdentitiesSafe = vi.spyOn(EmailVerificationService.prototype, 'listIdentitiesSafe').mockResolvedValue([]);
    service = new MentorshipService();
  });

  afterEach(() => {
    proxyRequest.mockRestore();
    getUserEmails.mockRestore();
    listIdentitiesSafe.mockRestore();
  });

  it('patches each of the caller mentor and mentee rows by id, and no other row', async () => {
    proxyRequest.mockResolvedValueOnce({
      data: [
        { id: 'profile-mentor-1', profile_type: 'mentor' },
        { id: 'profile-other-1', profile_type: 'maintainer' },
        { id: 'profile-mentee-1', profile_type: 'mentee' },
      ],
      meta: { total: 3 },
    });
    proxyRequest.mockResolvedValue({});

    await expect(service.syncLfxProfileFields(signedInReq(), fields)).resolves.toBe(2);

    expect(proxyRequest).toHaveBeenNthCalledWith(
      1,
      expect.anything(),
      'LFX_V2_SERVICE',
      '/mentorship/v1/me/profiles',
      'GET',
      expect.objectContaining({ offset: 0 }),
      undefined
    );
    expect(proxyRequest).toHaveBeenNthCalledWith(
      2,
      expect.anything(),
      'LFX_V2_SERVICE',
      '/mentorship/v1/me/profiles/by-id/profile-mentor-1',
      'PATCH',
      undefined,
      body
    );
    expect(proxyRequest).toHaveBeenNthCalledWith(
      3,
      expect.anything(),
      'LFX_V2_SERVICE',
      '/mentorship/v1/me/profiles/by-id/profile-mentee-1',
      'PATCH',
      undefined,
      body
    );
    expect(proxyRequest).toHaveBeenCalledTimes(3);
    expect(getUserEmails).toHaveBeenCalledWith(expect.anything(), 'auth0|test-user-1');
  });

  it('copies the verified primary email even when the body sends none', async () => {
    proxyRequest.mockResolvedValueOnce(mentorRow);
    proxyRequest.mockResolvedValue({});

    await expect(service.syncLfxProfileFields(signedInReq(), {})).resolves.toBe(1);
    expect(proxyRequest).toHaveBeenLastCalledWith(
      expect.anything(),
      'LFX_V2_SERVICE',
      '/mentorship/v1/me/profiles/by-id/profile-mentor-1',
      'PATCH',
      undefined,
      {
        email: 'test.user@example.com',
      }
    );
  });

  it('leaves the email out when the lookup fails, rather than clearing it', async () => {
    getUserEmails.mockResolvedValueOnce(null);
    proxyRequest.mockResolvedValueOnce(mentorRow);
    proxyRequest.mockResolvedValue({});

    await service.syncLfxProfileFields(signedInReq(), fields);
    expect(proxyRequest).toHaveBeenLastCalledWith(
      expect.anything(),
      'LFX_V2_SERVICE',
      '/mentorship/v1/me/profiles/by-id/profile-mentor-1',
      'PATCH',
      undefined,
      {
        first_name: 'Test',
      }
    );
  });

  it('skips the email lookup and patches nothing when the caller has no mentor or mentee row', async () => {
    proxyRequest.mockResolvedValueOnce({ data: [{ id: 'profile-other-1', profile_type: 'maintainer' }], meta: { total: 1 } });

    await expect(service.syncLfxProfileFields(signedInReq(), fields)).resolves.toBe(0);
    expect(proxyRequest).toHaveBeenCalledTimes(1);
    expect(getUserEmails).not.toHaveBeenCalled();
    expect(listIdentitiesSafe).not.toHaveBeenCalled();
  });

  it('patches nothing when there is nothing to copy', async () => {
    getUserEmails.mockResolvedValueOnce(null);
    proxyRequest.mockResolvedValueOnce(mentorRow);

    await expect(service.syncLfxProfileFields(signedInReq(), {})).resolves.toBe(0);
    expect(proxyRequest).toHaveBeenCalledTimes(1);
  });

  it("lays the connected GitHub link over each row's stored links, keeping the keys LFX One does not write", async () => {
    listIdentitiesSafe.mockResolvedValue([githubIdentity]);
    proxyRequest.mockResolvedValueOnce({
      data: [
        {
          id: 'profile-mentor-1',
          profile_type: 'mentor',
          profile_links: { resumeLink: 'https://example.com/r.pdf', githubProfileLink: 'https://github.com/old-login' },
        },
        { id: 'profile-mentee-1', profile_type: 'mentee', profile_links: null },
      ],
      meta: { total: 2 },
    });
    proxyRequest.mockResolvedValue({});

    await expect(service.syncLfxProfileFields(signedInReq(), {})).resolves.toBe(2);

    expect(proxyRequest).toHaveBeenNthCalledWith(
      2,
      expect.anything(),
      'LFX_V2_SERVICE',
      '/mentorship/v1/me/profiles/by-id/profile-mentor-1',
      'PATCH',
      undefined,
      {
        email: 'test.user@example.com',
        profile_links: { resumeLink: 'https://example.com/r.pdf', githubProfileLink: 'https://github.com/test-user' },
      }
    );
    expect(proxyRequest).toHaveBeenNthCalledWith(
      3,
      expect.anything(),
      'LFX_V2_SERVICE',
      '/mentorship/v1/me/profiles/by-id/profile-mentee-1',
      'PATCH',
      undefined,
      {
        email: 'test.user@example.com',
        profile_links: { githubProfileLink: 'https://github.com/test-user' },
      }
    );
    expect(listIdentitiesSafe).toHaveBeenCalledWith(expect.anything(), 'auth0|test-user-1');
  });

  it('copies the GitHub link alone when nothing else resolves', async () => {
    getUserEmails.mockResolvedValueOnce(null);
    listIdentitiesSafe.mockResolvedValue([githubIdentity]);
    proxyRequest.mockResolvedValueOnce(mentorRow);
    proxyRequest.mockResolvedValue({});

    await expect(service.syncLfxProfileFields(signedInReq(), {})).resolves.toBe(1);
    expect(proxyRequest).toHaveBeenLastCalledWith(
      expect.anything(),
      'LFX_V2_SERVICE',
      '/mentorship/v1/me/profiles/by-id/profile-mentor-1',
      'PATCH',
      undefined,
      {
        profile_links: { githubProfileLink: 'https://github.com/test-user' },
      }
    );
  });

  it('lets a failed patch through so the card can report it', async () => {
    const forbidden = Object.assign(new Error('forbidden'), { statusCode: 403 });
    proxyRequest.mockResolvedValueOnce(mentorRow);
    proxyRequest.mockRejectedValueOnce(forbidden);

    await expect(service.syncLfxProfileFields(signedInReq(), fields)).rejects.toBe(forbidden);
  });
});
