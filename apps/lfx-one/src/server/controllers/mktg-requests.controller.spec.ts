// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Request, Response } from 'express';
import type { MktgRequest } from '@lfx-one/shared/interfaces';
const fake = vi.hoisted(() => ({ project: vi.fn(), start: vi.fn(() => 0), success: vi.fn() }));
vi.mock('../services/project.service', () => ({
  ProjectService: class {
    public getProjectById = fake.project;
  },
}));
vi.mock('../services/object-store.service', () => ({ ObjectStoreService: class {} }));
vi.mock('../services/logger.service', () => ({ logger: { startOperation: fake.start, success: fake.success } }));
import { MktgRequestsController } from './mktg-requests.controller';
import { MktgRequestsService } from '../services/mktg-requests.service';
import { MicroserviceError } from '../errors';

const token = '11111111-1111-4111-8111-111111111111';
const body = { project: 'client-project', kind: 'asset', target: { familyId: 'positioning-brand' }, text: 'Synthetic request', clientRequestId: token };
const state = { project: body.project, state: 'done', clientRequestId: token };
const row: MktgRequest = {
  id: token,
  kind: 'asset',
  target: body.target,
  text: body.text,
  requestedBy: null,
  stateChangedBy: null,
  requesterCommittees: [],
  createdAt: '2026-10-23T12:00:00.000Z',
  state: 'open',
  stateChangedAt: '2026-10-23T12:00:00.000Z',
  note: null,
  isRequester: false,
};
const request = (value?: unknown, query: unknown = body.project, id: unknown = token): Request =>
  ({ path: '/requests', body: value, query: { project: query }, params: { id } }) as unknown as Request;
function response() {
  const res = { json: vi.fn(), status: vi.fn() };
  res.status.mockReturnValue(res);
  return res as typeof res & Response;
}

describe('MktgRequestsController', () => {
  let controller: MktgRequestsController;
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
    fake.project.mockResolvedValue({ uid: 'server-project', writer: true });
    vi.spyOn(MktgRequestsService.prototype, 'list').mockResolvedValue({ requests: [row], openCount: 1 });
    vi.spyOn(MktgRequestsService.prototype, 'create').mockResolvedValue(row);
    vi.spyOn(MktgRequestsService.prototype, 'changeState').mockResolvedValue(row);
    controller = new MktgRequestsController();
  });

  it.each(['list', 'create', 'changeState'] as const)('%s authorizes with annotation and uses only the SERVER uid', async (method) => {
    const req = request(method === 'create' ? body : state);
    const res = response();
    const next = vi.fn();
    await controller[method](req, res, next);
    expect(fake.project).toHaveBeenCalledWith(req, 'client-project', true);
    const args: unknown[] = [req, 'server-project'];
    if (method === 'create') args.push(body);
    if (method === 'changeState') args.push(token, state);
    expect(MktgRequestsService.prototype[method]).toHaveBeenCalledWith(...args);
    expect(next).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalled();
    expect(fake.start).toHaveBeenCalledTimes(1);
    expect(fake.success).toHaveBeenCalledTimes(1);
    if (method === 'create') expect(res.status).toHaveBeenCalledWith(201);
  });

  it.each(['list', 'create', 'changeState'] as const)('%s rejects writer denial or unsafe resolved partition before storage', async (method) => {
    for (const project of [
      { uid: 'server-project', writer: false },
      { uid: '../unsafe', writer: true },
    ]) {
      fake.project.mockResolvedValue(project);
      const next = vi.fn();
      const res = response();
      await controller[method](request(method === 'create' ? body : state), res, next);
      expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 403 }));
      expect(MktgRequestsService.prototype[method]).not.toHaveBeenCalled();
      expect(res.json).not.toHaveBeenCalled();
    }
  });

  it.each([undefined, '', '../unsafe', ['project'], {}])('rejects invalid project %j without lookup', async (project) => {
    const next = vi.fn();
    const req = request();
    req.query = { project } as Request['query'];
    await controller.list(req, response(), next);
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 400 }));
    expect(fake.project).not.toHaveBeenCalled();
  });

  it.each([
    { ...body, text: '' },
    { ...body, kind: 'change' },
    { ...body, target: { familyId: 'unknown' } },
    { ...body, target: { ...body.target, agentKey: 'unknown' } },
    { ...body, project: '../unsafe' },
    { ...body, clientRequestId: 'bad' },
    null,
    [],
  ])('validates create before lookup %#', async (invalid) => {
    const next = vi.fn();
    await controller.create(request(invalid), response(), next);
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 400 }));
    expect(fake.project).not.toHaveBeenCalled();
  });

  it.each([
    { ...state, state: 'declined' },
    { ...state, state: 'unknown' },
    { ...state, resultRevisionId: 'bad' },
    { ...state, note: 5 },
  ])('validates state before lookup %#', async (invalid) => {
    const next = vi.fn();
    await controller.changeState(request(invalid), response(), next);
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 400 }));
    expect(fake.project).not.toHaveBeenCalled();
  });

  it('accepts an explicit withdrawal without a caller-owned state or note', async () => {
    const withdraw = { project: body.project, clientRequestId: token, withdraw: true };
    const req = request(withdraw);
    const next = vi.fn();
    await controller.changeState(req, response(), next);
    expect(MktgRequestsService.prototype.changeState).toHaveBeenCalledWith(req, 'server-project', token, withdraw);
    expect(next).not.toHaveBeenCalled();
  });

  it.each(['../unsafe', '', ['id']])('rejects unsafe request id %j', async (id) => {
    const next = vi.fn();
    await controller.changeState(request(state, body.project, id), response(), next);
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 400 }));
    expect(fake.project).not.toHaveBeenCalled();
  });

  it.each(['list', 'create', 'changeState'] as const)('%s forwards lookup and storage errors without a success response', async (method) => {
    const error = new MicroserviceError('Synthetic outage', 503, 'SYNTHETIC_OUTAGE');
    for (const failure of ['lookup', 'storage']) {
      if (failure === 'lookup') fake.project.mockRejectedValueOnce(error);
      else vi.mocked(MktgRequestsService.prototype[method]).mockRejectedValueOnce(error);
      const next = vi.fn();
      const res = response();
      await controller[method](request(method === 'create' ? body : state), res, next);
      expect(next).toHaveBeenCalledWith(error);
      expect(res.json).not.toHaveBeenCalled();
    }
    expect(fake.success).not.toHaveBeenCalled();
  });
});
