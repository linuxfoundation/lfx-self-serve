// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import '@angular/compiler';

import type { UpstreamProjectApplication, UpstreamProjectApplicationDoc } from '@lfx-one/shared/interfaces';
import type { Request } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { MicroserviceError } from '../errors/microservice.error';

const proxyRequest = vi.fn();
const proxyRequestWithResponse = vi.fn();
const checkSingleAccess = vi.fn();
const checkSingleAccessStrict = vi.fn();
const generateM2MToken = vi.fn();
const warning = vi.fn();

vi.mock('./microservice-proxy.service', () => ({
  MicroserviceProxyService: class {
    public proxyRequest = (...args: unknown[]) => proxyRequest(...args);
    public proxyRequestWithResponse = (...args: unknown[]) => proxyRequestWithResponse(...args);
  },
}));
vi.mock('./access-check.service', () => ({
  AccessCheckService: class {
    public checkSingleAccess = (...args: unknown[]) => checkSingleAccess(...args);
    public checkSingleAccessStrict = (...args: unknown[]) => checkSingleAccessStrict(...args);
  },
}));
const getProjectIdBySlug = vi.fn();
vi.mock('./project.service', () => ({
  ProjectService: class {
    public getProjectIdBySlug = (...args: unknown[]) => getProjectIdBySlug(...args);
  },
}));
vi.mock('../utils/m2m-token.util', () => ({ generateM2MToken: (...args: unknown[]) => generateM2MToken(...args) }));
vi.mock('./logger.service', () => ({
  logger: {
    startOperation: vi.fn(() => 0),
    success: vi.fn(),
    error: vi.fn(),
    warning: (...args: unknown[]) => warning(...args),
    debug: vi.fn(),
    info: vi.fn(),
  },
}));

const { ProjectApplicationService } = await import('./project-application.service');

const UID = '3f2b8c1e-7a4d-4e1b-9c2a-5d6e7f8a9b0c';
const PARENT_UID = '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d';
const req = { path: '/api/project-applications', bearerToken: 'user-token' } as unknown as Request;

function upstreamApp(overrides: Partial<UpstreamProjectApplication> = {}): UpstreamProjectApplication {
  return {
    uid: UID,
    state: 'submitted',
    revision: 1,
    submitter_username: 'jdoe',
    submitter_name: 'Jane Doe',
    submitter_email: 'jane@example.org',
    application: { project_name: 'Example Foundation' },
    created_at: '2026-09-01T00:00:00Z',
    updated_at: '2026-09-01T00:00:00Z',
    ...overrides,
  };
}

function doc(overrides: Partial<UpstreamProjectApplicationDoc> = {}): UpstreamProjectApplicationDoc {
  return {
    object_id: UID,
    state: 'submitted',
    revision: 1,
    submitter_username: 'jdoe',
    submitter_name: 'Jane Doe',
    submitter_email: 'jane@example.org',
    application: { project_name: 'Example Foundation' },
    created_at: '2026-09-01T00:00:00Z',
    updated_at: '2026-09-01T00:00:00Z',
    ...overrides,
  };
}

describe('ProjectApplicationService', () => {
  let service: InstanceType<typeof ProjectApplicationService>;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new ProjectApplicationService();
  });

  describe('listMine', () => {
    it('queries by submitter tag with the caller token and drops documents submitted by anyone else', async () => {
      proxyRequest.mockResolvedValueOnce({
        resources: [
          { type: 'project_application', id: 'a', data: doc({ object_id: 'a', created_at: '2026-09-01T00:00:00Z' }) },
          { type: 'project_application', id: 'b', data: doc({ object_id: 'b', submitter_username: 'someone-else' }) },
          { type: 'project_application', id: 'c', data: doc({ object_id: 'c', created_at: '2026-09-05T00:00:00Z' }) },
        ],
      });

      const result = await service.listMine(req, 'auth0|jdoe');

      expect(proxyRequest).toHaveBeenCalledWith(req, 'LFX_V2_SERVICE', '/query/resources', 'GET', {
        type: 'project_application',
        tags: ['submitter:jdoe'],
        page_size: 100,
      });
      // No 8th argument: the read runs on the caller's own token, never M2M.
      expect(proxyRequest.mock.calls[0]).toHaveLength(5);
      expect(result.map((app) => app.uid)).toEqual(['c', 'a']);
      expect(warning).toHaveBeenCalledWith(req, 'list_my_project_applications', expect.any(String), { dropped: 1 });
    });
  });

  describe('listQueue', () => {
    it('queries every application with no project-tree or submitter filter', async () => {
      proxyRequest.mockResolvedValueOnce({ resources: [{ type: 'project_application', id: 'a', data: doc({ submitter_username: 'other' }) }] });

      const result = await service.listQueue(req);

      expect(proxyRequest.mock.calls[0][4]).toEqual({ type: 'project_application', page_size: 100 });
      expect(result).toHaveLength(1);
      expect(result[0].uid).toBe(UID);
    });
  });

  describe('isFormationTeamMember', () => {
    it('checks team:formation#member', async () => {
      checkSingleAccess.mockResolvedValueOnce(true);
      await expect(service.isFormationTeamMember(req)).resolves.toBe(true);
      expect(checkSingleAccess).toHaveBeenCalledWith(req, { resource: 'team', id: 'formation', access: 'member' });
    });
  });

  describe('create', () => {
    it('posts with a scoped M2M token and never touches req.bearerToken', async () => {
      generateM2MToken.mockResolvedValueOnce('m2m-token');
      proxyRequestWithResponse.mockResolvedValueOnce({ data: upstreamApp(), headers: {} });
      const payload = { submitter_username: 'jdoe', submitter_name: 'Jane Doe', submitter_email: 'jane@example.org', application: { project_name: 'X' } };

      const result = await service.create(req, payload);

      expect(proxyRequestWithResponse).toHaveBeenCalledWith(req, 'LFX_V2_FORMATION_SERVICE', '/project-applications', 'POST', undefined, payload, undefined, {
        bearerToken: 'm2m-token',
      });
      expect(req.bearerToken).toBe('user-token');
      expect(result.application.uid).toBe(UID);
      expect(result.etag).toBeNull();
    });

    it('maps application_field_invalid to a 400 with the upstream reason as code', async () => {
      generateM2MToken.mockResolvedValueOnce('m2m-token');
      proxyRequestWithResponse.mockRejectedValueOnce(
        new MicroserviceError('bad', 400, 'BAD_REQUEST', {
          errorBody: { reason: 'application_field_invalid', message: 'project_website must be an http or https URL' },
        })
      );

      await expect(
        service.create(req, { submitter_username: 'a', submitter_name: 'a', submitter_email: 'a@example.org', application: {} })
      ).rejects.toMatchObject({
        statusCode: 400,
        code: 'APPLICATION_FIELD_INVALID',
        message: 'project_website must be an http or https URL',
      });
    });
  });

  describe('revise / withdraw / deny / delete', () => {
    it('revise PUTs the complete answer map with If-Match and returns the ETag', async () => {
      proxyRequestWithResponse.mockResolvedValueOnce({ data: upstreamApp({ revision: 2 }), headers: { etag: '2' } });
      const answers = { project_name: 'Renamed', future_key: 'kept' };

      const result = await service.revise(req, UID, '1', answers);

      expect(proxyRequestWithResponse).toHaveBeenCalledWith(
        req,
        'LFX_V2_FORMATION_SERVICE',
        `/project-applications/${UID}`,
        'PUT',
        undefined,
        { application: answers },
        {
          'If-Match': '1',
        }
      );
      expect(result).toMatchObject({ etag: '2', application: { revision: 2 } });
    });

    it.each([
      ['withdraw', 'withdraw'],
      ['deny', 'deny'],
    ] as const)('%s POSTs the action route with If-Match on the user token', async (method, action) => {
      proxyRequestWithResponse.mockResolvedValueOnce({ data: upstreamApp({ state: `${action}n`, revision: 4 }), headers: { etag: '"4"' } });

      const result = await service[method](req, UID, '3');

      expect(proxyRequestWithResponse).toHaveBeenCalledWith(
        req,
        'LFX_V2_FORMATION_SERVICE',
        `/project-applications/${UID}/${action}`,
        'POST',
        undefined,
        undefined,
        {
          'If-Match': '3',
        }
      );
      expect(result.etag).toBe('4');
    });

    it('delete sends If-Match', async () => {
      proxyRequest.mockResolvedValueOnce(null);
      await service.remove(req, UID, '7');
      expect(proxyRequest).toHaveBeenCalledWith(req, 'LFX_V2_FORMATION_SERVICE', `/project-applications/${UID}`, 'DELETE', undefined, undefined, {
        'If-Match': '7',
      });
    });

    it.each([
      [412, 'PRECONDITION_FAILED'],
      [404, 'NOT_FOUND'],
      [403, 'PROJECT_APPLICATION_FORBIDDEN'],
    ])('maps upstream %i to %s', async (status, code) => {
      proxyRequestWithResponse.mockRejectedValueOnce(new MicroserviceError('x', status, 'X', { errorBody: { reason: 'r' } }));
      await expect(service.withdraw(req, UID, '1')).rejects.toMatchObject({ statusCode: status, code });
    });
  });

  describe('accept', () => {
    const SLUG = 'example-project';
    const PROJECT_UID = '1b2c3d4e-5f6a-4b7c-8d9e-0f1a2b3c4d5e';
    const answers = {
      project_name: 'Example Project',
      description: 'About it',
      mission_statement: 'Mission',
      project_repository_url: 'https://github.com/example/project',
      project_website: '',
      is_spec_project: true,
      future_key: 'kept',
    };
    const recorded = { ...answers, parent_project_uid: PARENT_UID, project_slug: SLUG };

    beforeEach(() => {
      getProjectIdBySlug.mockReset().mockResolvedValue({ uid: '', slug: SLUG, exists: false });
    });

    it('records the choices, creates the project with the user token, records its uid, then accepts', async () => {
      checkSingleAccessStrict.mockResolvedValueOnce(true);
      proxyRequestWithResponse
        .mockResolvedValueOnce({ data: upstreamApp({ revision: 6, application: recorded }), headers: { etag: '6' } })
        .mockResolvedValueOnce({ data: upstreamApp({ revision: 7, application: { ...recorded, project_uid: PROJECT_UID } }), headers: { etag: '7' } })
        .mockResolvedValueOnce({ data: upstreamApp({ revision: 8, state: 'accepted' }), headers: { etag: '8' } });
      proxyRequest.mockResolvedValueOnce({ uid: PROJECT_UID, slug: SLUG });

      const result = await service.accept(req, UID, '5', answers, PARENT_UID, SLUG);

      expect(proxyRequestWithResponse.mock.calls[0].slice(2)).toEqual([
        `/project-applications/${UID}`,
        'PUT',
        undefined,
        { application: recorded },
        { 'If-Match': '5' },
      ]);
      expect(proxyRequest).toHaveBeenCalledTimes(1);
      expect(proxyRequest.mock.calls[0]).toEqual([
        req,
        'LFX_V2_SERVICE',
        '/projects',
        'POST',
        undefined,
        {
          name: 'Example Project',
          slug: SLUG,
          description: 'About it',
          parent_uid: PARENT_UID,
          mission_statement: 'Mission',
          repository_url: 'https://github.com/example/project',
          stage: 'Formation - Exploratory',
          legal_entity_type: 'Subproject',
          category: 'Standards',
        },
        { 'X-Sync': 'true' },
      ]);
      // No token override: project-service authorizes the caller's own token.
      expect(generateM2MToken).not.toHaveBeenCalled();
      expect(proxyRequestWithResponse.mock.calls[1].slice(2)).toEqual([
        `/project-applications/${UID}`,
        'PUT',
        undefined,
        { application: { ...recorded, project_uid: PROJECT_UID } },
        { 'If-Match': '6' },
      ]);
      expect(proxyRequestWithResponse.mock.calls[2].slice(2)).toEqual([
        `/project-applications/${UID}/accept`,
        'POST',
        undefined,
        undefined,
        { 'If-Match': '7' },
      ]);
      expect(result).toMatchObject({ etag: '8', application: { state: 'accepted', revision: 8 } });
    });

    it('skips the create on a retry once the project uid is recorded', async () => {
      checkSingleAccessStrict.mockResolvedValueOnce(true);
      proxyRequestWithResponse
        .mockResolvedValueOnce({ data: upstreamApp({ revision: 6, application: { ...recorded, project_uid: PROJECT_UID } }), headers: { etag: '6' } })
        .mockResolvedValueOnce({ data: upstreamApp({ revision: 7, state: 'accepted' }), headers: { etag: '7' } });

      await service.accept(req, UID, '5', { ...answers, project_uid: PROJECT_UID }, PARENT_UID, SLUG);

      expect(proxyRequest).not.toHaveBeenCalled();
      expect(proxyRequestWithResponse).toHaveBeenCalledTimes(2);
      expect(proxyRequestWithResponse.mock.calls[1].slice(2, 4)).toEqual([`/project-applications/${UID}/accept`, 'POST']);
      expect(proxyRequestWithResponse.mock.calls[1][6]).toEqual({ 'If-Match': '6' });
    });

    it.each([
      [409, 'PROJECT_SLUG_CONFLICT'],
      [403, 'PROJECT_CREATE_FORBIDDEN'],
      [400, 'INVALID_PROJECT'],
    ])('maps a project create refused with %i to %s and never accepts', async (status, code) => {
      checkSingleAccessStrict.mockResolvedValueOnce(true);
      proxyRequestWithResponse.mockResolvedValueOnce({ data: upstreamApp({ revision: 6, application: recorded }), headers: { etag: '6' } });
      proxyRequest.mockRejectedValueOnce(new MicroserviceError('refused', status, 'X', { errorBody: { message: 'upstream says no' } }));

      await expect(service.accept(req, UID, '5', answers, PARENT_UID, SLUG)).rejects.toMatchObject({ statusCode: status, code });
      expect(proxyRequestWithResponse).toHaveBeenCalledTimes(1);
    });

    it('adopts the project an earlier accept created but never recorded, when the slug conflict is under the same parent and name', async () => {
      checkSingleAccessStrict.mockResolvedValueOnce(true);
      proxyRequestWithResponse
        .mockResolvedValueOnce({ data: upstreamApp({ revision: 6, application: recorded }), headers: { etag: '6' } })
        .mockResolvedValueOnce({ data: upstreamApp({ revision: 7, application: { ...recorded, project_uid: PROJECT_UID } }), headers: { etag: '7' } })
        .mockResolvedValueOnce({ data: upstreamApp({ revision: 8, state: 'accepted' }), headers: { etag: '8' } });
      proxyRequest
        .mockRejectedValueOnce(new MicroserviceError('conflict', 409, 'CONFLICT', { errorBody: {} }))
        .mockResolvedValueOnce({ uid: PROJECT_UID, slug: SLUG, name: 'Example Project', parent_uid: PARENT_UID });
      getProjectIdBySlug.mockResolvedValueOnce({ uid: PROJECT_UID, slug: SLUG, exists: true });

      const result = await service.accept(req, UID, '5', answers, PARENT_UID, SLUG);

      expect(proxyRequest.mock.calls[1].slice(1, 4)).toEqual(['LFX_V2_SERVICE', `/projects/${PROJECT_UID}`, 'GET']);
      expect(proxyRequestWithResponse.mock.calls[1][5]).toEqual({ application: { ...recorded, project_uid: PROJECT_UID } });
      expect(result.application.state).toBe('accepted');
    });

    it.each([
      ['another parent', { parent_uid: 'other-parent', name: 'Example Project' }],
      ['another name', { parent_uid: PARENT_UID, name: 'Someone Else' }],
    ])('treats a slug conflict with a project under %s as a genuine conflict', async (_label, found) => {
      checkSingleAccessStrict.mockResolvedValueOnce(true);
      proxyRequestWithResponse.mockResolvedValueOnce({ data: upstreamApp({ revision: 6, application: recorded }), headers: { etag: '6' } });
      proxyRequest
        .mockRejectedValueOnce(new MicroserviceError('conflict', 409, 'CONFLICT', { errorBody: {} }))
        .mockResolvedValueOnce({ uid: PROJECT_UID, slug: SLUG, ...found });
      getProjectIdBySlug.mockResolvedValueOnce({ uid: PROJECT_UID, slug: SLUG, exists: true });

      await expect(service.accept(req, UID, '5', answers, PARENT_UID, SLUG)).rejects.toMatchObject({ statusCode: 409, code: 'PROJECT_SLUG_CONFLICT' });
      expect(proxyRequestWithResponse).toHaveBeenCalledTimes(1);
    });

    it('keeps the recorded parent and slug on a retry once the project exists, ignoring new dialog choices', async () => {
      checkSingleAccessStrict.mockResolvedValueOnce(true);
      const withProject = { ...recorded, project_uid: PROJECT_UID };
      proxyRequestWithResponse
        .mockResolvedValueOnce({ data: upstreamApp({ revision: 6, application: withProject }), headers: { etag: '6' } })
        .mockResolvedValueOnce({ data: upstreamApp({ revision: 7, state: 'accepted' }), headers: { etag: '7' } });

      await service.accept(req, UID, '5', withProject, 'another-parent', 'another-slug');

      expect(proxyRequestWithResponse.mock.calls[0][5]).toEqual({ application: withProject });
      expect(proxyRequest).not.toHaveBeenCalled();
    });

    it('aborts without writing when membership cannot be verified (access-check outage)', async () => {
      checkSingleAccessStrict.mockRejectedValueOnce(new MicroserviceError('unavailable', 503, 'SERVICE_UNAVAILABLE', { errorBody: {} }));

      await expect(service.accept(req, UID, '5', {}, PARENT_UID, SLUG)).rejects.toMatchObject({ statusCode: 503 });
      expect(proxyRequestWithResponse).not.toHaveBeenCalled();
      expect(proxyRequest).not.toHaveBeenCalled();
    });

    it('refuses a caller outside the formation team before writing anything', async () => {
      checkSingleAccessStrict.mockResolvedValueOnce(false);

      await expect(service.accept(req, UID, '5', {}, PARENT_UID, SLUG)).rejects.toMatchObject({ statusCode: 403, code: 'PROJECT_APPLICATION_FORBIDDEN' });
      expect(proxyRequestWithResponse).not.toHaveBeenCalled();
      expect(proxyRequest).not.toHaveBeenCalled();
    });

    it('propagates a failed accept after the project was recorded, without retrying, using the latest If-Match', async () => {
      checkSingleAccessStrict.mockResolvedValueOnce(true);
      proxyRequestWithResponse
        .mockResolvedValueOnce({ data: upstreamApp({ revision: 6, application: recorded }), headers: { etag: '6' } })
        .mockResolvedValueOnce({ data: upstreamApp({ revision: 7, application: { ...recorded, project_uid: PROJECT_UID } }), headers: { etag: '7' } })
        .mockRejectedValueOnce(new MicroserviceError('conflict', 409, 'CONFLICT', { errorBody: { reason: 'invalid_transition', message: 'Not open' } }));
      proxyRequest.mockResolvedValueOnce({ uid: PROJECT_UID, slug: SLUG });

      await expect(service.accept(req, UID, '5', answers, PARENT_UID, SLUG)).rejects.toMatchObject({ statusCode: 409, code: 'INVALID_TRANSITION' });
      expect(proxyRequestWithResponse).toHaveBeenCalledTimes(3);
      expect(proxyRequestWithResponse.mock.calls[2][6]).toEqual({ 'If-Match': '7' });
    });

    it('creates nothing when the first revise is refused', async () => {
      checkSingleAccessStrict.mockResolvedValueOnce(true);
      proxyRequestWithResponse.mockRejectedValueOnce(new MicroserviceError('stale', 412, 'PRECONDITION_FAILED', { errorBody: {} }));

      await expect(service.accept(req, UID, '5', {}, PARENT_UID, SLUG)).rejects.toMatchObject({ statusCode: 412 });
      expect(proxyRequestWithResponse).toHaveBeenCalledTimes(1);
      expect(proxyRequest).not.toHaveBeenCalled();
    });
  });
});
