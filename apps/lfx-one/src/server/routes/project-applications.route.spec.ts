// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// The shared utils barrel transitively reaches Angular's partially-compiled packages, which need the JIT
// compiler under vitest.
import '@angular/compiler';

import express from 'express';
import type { Server } from 'node:http';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Router-level coverage for `/api/project-applications` (#3037): identity is taken from the session and
 * never from the body, writes are refused during impersonation, every mutation requires `If-Match` and a
 * UUID, invalid answers are refused before any upstream call, and accept requires a parent project and a valid slug.
 */

const service = {
  listMine: vi.fn(),
  listQueue: vi.fn(),
  isFormationTeamMember: vi.fn(),
  isFormationTeamMemberStrict: vi.fn(),
  create: vi.fn(),
  revise: vi.fn(),
  withdraw: vi.fn(),
  accept: vi.fn(),
  deny: vi.fn(),
  remove: vi.fn(),
  assertFormationTeamMember: vi.fn(),
};
const auth = {
  getUsernameFromAuth: vi.fn(),
  getEffectiveName: vi.fn(),
  getEffectiveEmail: vi.fn(),
  isImpersonating: vi.fn(),
};

vi.mock('../services/project-application.service', () => ({ projectApplicationService: service }));
vi.mock('../utils/auth-helper', () => ({
  getUsernameFromAuth: (...args: unknown[]) => auth.getUsernameFromAuth(...args),
  getEffectiveName: (...args: unknown[]) => auth.getEffectiveName(...args),
  getEffectiveEmail: (...args: unknown[]) => auth.getEffectiveEmail(...args),
  isImpersonating: (...args: unknown[]) => auth.isImpersonating(...args),
  stripAuthPrefix: (value: string) => value.replace(/^[^|]+\|/, ''),
}));
vi.mock('../services/logger.service', () => ({
  logger: {
    info: vi.fn(),
    warning: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    startOperation: vi.fn(() => Date.now()),
    success: vi.fn(),
    getLastOperation: vi.fn(() => undefined),
  },
}));

const router = (await import('./project-applications.route')).default;
const { apiErrorHandler } = await import('../middleware/error-handler.middleware');

const UID = '3f2b8c1e-7a4d-4e1b-9c2a-5d6e7f8a9b0c';
const PARENT_UID = '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d';
const APP = { uid: UID, state: 'submitted', revision: 2, application: { project_name: 'Example' } };

let server: Server;
let baseUrl: string;

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use('/api/project-applications', router);
  app.use(apiErrorHandler);
  await new Promise<void>((resolve) => {
    server = app.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  baseUrl = `http://127.0.0.1:${port}/api/project-applications`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

beforeEach(() => {
  vi.clearAllMocks();
  auth.getUsernameFromAuth.mockResolvedValue('auth0|jdoe');
  auth.getEffectiveName.mockReturnValue('Jane Doe');
  auth.getEffectiveEmail.mockReturnValue('jane@example.org');
  auth.isImpersonating.mockReturnValue(false);
  for (const fn of [service.create, service.revise, service.withdraw, service.accept, service.deny]) {
    fn.mockResolvedValue({ application: APP, etag: '3' });
  }
  service.remove.mockResolvedValue(undefined);
  service.assertFormationTeamMember.mockResolvedValue(undefined);
});

function send(method: string, path: string, body?: unknown, headers: Record<string, string> = {}) {
  return fetch(`${baseUrl}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...headers },
    ...(body !== undefined && { body: JSON.stringify(body) }),
  });
}

describe('reads', () => {
  it('GET /mine lists the stripped session user and marks the response private', async () => {
    service.listMine.mockResolvedValue([APP]);
    const res = await send('GET', '/mine');
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('private, no-store');
    expect(service.listMine).toHaveBeenCalledWith(expect.anything(), 'jdoe');
    expect(await res.json()).toEqual([APP]);
  });

  it('GET /mine refuses an anonymous caller', async () => {
    auth.getUsernameFromAuth.mockResolvedValue(null);
    const res = await send('GET', '/mine');
    expect(res.status).toBe(401);
    expect(service.listMine).not.toHaveBeenCalled();
  });

  it('GET /access reports formation-team membership', async () => {
    service.isFormationTeamMember.mockResolvedValue(true);
    const res = await send('GET', '/access');
    expect(await res.json()).toEqual({ is_formation_team: true });
  });
});

describe('create', () => {
  it('copies the identity from the session and ignores identity fields in the body', async () => {
    const res = await send('POST', '/', { submitter_username: 'mallory', submitter_email: 'mallory@example.org', application: { project_name: 'Example' } });

    expect(res.status).toBe(201);
    expect(service.create).toHaveBeenCalledWith(expect.anything(), {
      submitter_username: 'jdoe',
      submitter_name: 'Jane Doe',
      submitter_email: 'jane@example.org',
      application: { project_name: 'Example' },
    });
  });

  it('never forwards the staff-only keys (parent, slug, project uid) at create time', async () => {
    await send('POST', '/', { application: { project_name: 'Example', parent_project_uid: PARENT_UID, project_slug: 'example', project_uid: PARENT_UID } });
    expect(service.create.mock.calls[0][1].application).toEqual({ project_name: 'Example' });
  });

  it('falls back to the username when the session has no display name', async () => {
    auth.getEffectiveName.mockReturnValue(null);
    await send('POST', '/', { application: {} });
    expect(service.create.mock.calls[0][1].submitter_name).toBe('jdoe');
  });

  it('refuses a session without an email', async () => {
    auth.getEffectiveEmail.mockReturnValue(null);
    const res = await send('POST', '/', { application: {} });
    expect(res.status).toBe(400);
    expect(service.create).not.toHaveBeenCalled();
  });

  it('refuses invalid answers before calling upstream', async () => {
    const res = await send('POST', '/', { application: { project_repository_url: 'ftp://example.org' } });
    expect(res.status).toBe(400);
    expect(service.create).not.toHaveBeenCalled();
  });

  it('refuses a missing application object', async () => {
    const res = await send('POST', '/', {});
    expect(res.status).toBe(400);
  });
});

describe('impersonation', () => {
  it.each([
    ['POST', '/'],
    ['PUT', `/${UID}`],
    ['POST', `/${UID}/withdraw`],
    ['POST', `/${UID}/accept`],
    ['POST', `/${UID}/deny`],
    ['DELETE', `/${UID}`],
  ])('%s %s is refused while impersonating', async (method, path) => {
    auth.isImpersonating.mockReturnValue(true);
    const res = await send(method, path, { application: {}, parent_project_uid: PARENT_UID, project_slug: 'example' }, { 'If-Match': '2' });
    expect(res.status).toBe(403);
    expect((await res.json()).code).toBe('IMPERSONATION_READ_ONLY');
  });
});

describe('mutations', () => {
  it('revise forwards uid, If-Match and the complete answers, and echoes the ETag', async () => {
    const answers = { project_name: 'Renamed', future_key: 'kept' };
    const res = await send('PUT', `/${UID}`, { application: answers }, { 'If-Match': '2' });
    expect(res.status).toBe(200);
    expect(res.headers.get('etag')).toBe('3');
    expect(service.revise).toHaveBeenCalledWith(expect.anything(), UID, '2', answers);
  });

  it('revise without a parent key skips the formation-team check', async () => {
    await send('PUT', `/${UID}`, { application: { project_name: 'X' } }, { 'If-Match': '2' });
    expect(service.isFormationTeamMemberStrict).not.toHaveBeenCalled();
  });

  it('revise drops parent_project_uid sent by a caller outside the formation team, and still revises', async () => {
    service.isFormationTeamMemberStrict.mockResolvedValue(false);
    const res = await send('PUT', `/${UID}`, { application: { project_name: 'X', parent_project_uid: PARENT_UID } }, { 'If-Match': '2' });
    expect(res.status).toBe(200);
    expect(service.revise).toHaveBeenCalledWith(expect.anything(), UID, '2', { project_name: 'X' });
  });

  it('revise drops a planted project_uid or project_slug from a caller outside the formation team', async () => {
    service.isFormationTeamMemberStrict.mockResolvedValue(false);
    await send('PUT', `/${UID}`, { application: { project_name: 'X', project_uid: PARENT_UID, project_slug: 'x' } }, { 'If-Match': '2' });
    expect(service.revise).toHaveBeenCalledWith(expect.anything(), UID, '2', { project_name: 'X' });
  });

  it('revise keeps parent_project_uid for a formation-team member', async () => {
    service.isFormationTeamMemberStrict.mockResolvedValue(true);
    await send('PUT', `/${UID}`, { application: { project_name: 'X', parent_project_uid: PARENT_UID } }, { 'If-Match': '2' });
    expect(service.revise).toHaveBeenCalledWith(expect.anything(), UID, '2', { project_name: 'X', parent_project_uid: PARENT_UID });
  });

  it('revise aborts, and writes nothing, when membership cannot be verified', async () => {
    const { MicroserviceError } = await import('../errors/microservice.error');
    service.isFormationTeamMemberStrict.mockRejectedValueOnce(new MicroserviceError('unavailable', 503, 'SERVICE_UNAVAILABLE', { errorBody: {} }));
    const res = await send('PUT', `/${UID}`, { application: { project_name: 'X', parent_project_uid: PARENT_UID } }, { 'If-Match': '2' });
    expect(res.status).toBe(503);
    expect(service.revise).not.toHaveBeenCalled();
  });

  it('refuses a mutation without If-Match', async () => {
    const res = await send('POST', `/${UID}/withdraw`);
    expect(res.status).toBe(400);
    expect(service.withdraw).not.toHaveBeenCalled();
  });

  it('refuses a non-UUID uid', async () => {
    const res = await send('POST', '/not-a-uuid/deny', undefined, { 'If-Match': '2' });
    expect(res.status).toBe(400);
    expect(service.deny).not.toHaveBeenCalled();
  });

  it('accept requires a parent project', async () => {
    const res = await send('POST', `/${UID}/accept`, { application: {} }, { 'If-Match': '2' });
    expect(res.status).toBe(400);
    expect(service.accept).not.toHaveBeenCalled();
  });

  it.each([undefined, '', 'Has-Caps', '1starts-with-digit', 'ends-with-dash-', 'a', 'has space'])('accept refuses project slug %j', async (slug) => {
    const res = await send('POST', `/${UID}/accept`, { parent_project_uid: PARENT_UID, project_slug: slug, application: {} }, { 'If-Match': '2' });
    expect(res.status).toBe(400);
    expect(service.accept).not.toHaveBeenCalled();
  });

  it('accept forwards the parent, the slug and the complete answers', async () => {
    const res = await send(
      'POST',
      `/${UID}/accept`,
      { parent_project_uid: PARENT_UID, project_slug: 'my_project-1', application: { project_name: 'X' } },
      { 'If-Match': '2' }
    );
    expect(res.status).toBe(200);
    expect(service.accept).toHaveBeenCalledWith(expect.anything(), UID, '2', { project_name: 'X' }, PARENT_UID, 'my_project-1');
  });

  it('delete returns 204', async () => {
    const res = await send('DELETE', `/${UID}`, undefined, { 'If-Match': '2' });
    expect(res.status).toBe(204);
    expect(service.remove).toHaveBeenCalledWith(expect.anything(), UID, '2');
  });

  it('surfaces a stale revision as 412', async () => {
    const { PreconditionFailedError } = await import('../errors');
    service.deny.mockRejectedValue(new PreconditionFailedError('stale'));
    const res = await send('POST', `/${UID}/deny`, undefined, { 'If-Match': '2' });
    expect(res.status).toBe(412);
  });
});
