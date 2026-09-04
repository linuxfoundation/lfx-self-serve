// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import '@angular/compiler';

import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getUsernameFromAuth } = vi.hoisted(() => ({ getUsernameFromAuth: vi.fn<() => Promise<string | null>>() }));
const { listClaGroups } = vi.hoisted(() => ({ listClaGroups: vi.fn() }));

vi.mock('../utils/auth-helper', () => ({ getUsernameFromAuth }));
vi.mock('../services/org-cla.service', () => ({
  OrgClaService: class {
    public listClaGroups = listClaGroups;
  },
}));
vi.mock('../services/logger.service', () => ({
  logger: { startOperation: vi.fn(() => 0), success: vi.fn(), warning: vi.fn(), error: vi.fn(), debug: vi.fn(), info: vi.fn() },
}));

import { AuthenticationError } from '../errors';
import { OrgClasController } from './org-clas.controller';

function buildRes() {
  return { json: vi.fn(), status: vi.fn().mockReturnThis(), send: vi.fn() } as any;
}

beforeEach(() => {
  vi.clearAllMocks();
  getUsernameFromAuth.mockResolvedValue('alice');
});

describe('OrgClasController.listClaGroups', () => {
  it('returns 401 (via next) when there is no authenticated user', async () => {
    getUsernameFromAuth.mockResolvedValue(null);
    const res = buildRes();
    const next = vi.fn();

    await new OrgClasController().listClaGroups({ params: { orgUid: '0014100000Te2ovAAB' }, query: {}, body: {} } as any, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(next.mock.calls[0][0]).toBeInstanceOf(AuthenticationError);
    expect(res.json).not.toHaveBeenCalled();
    expect(listClaGroups).not.toHaveBeenCalled();
  });

  it('never passes a client-supplied user id to the service', async () => {
    const response = { orgUid: '0014100000Te2ovAAB', claGroups: [] };
    listClaGroups.mockResolvedValue(response);
    const res = buildRes();
    const req = {
      params: { orgUid: '0014100000Te2ovAAB' },
      body: { userId: 'someone-else' },
      query: { userID: 'someone-else' },
    } as any;

    await new OrgClasController().listClaGroups(req, res, vi.fn());

    expect(listClaGroups).toHaveBeenCalledWith(req, '0014100000Te2ovAAB');
    expect(listClaGroups).toHaveBeenCalledTimes(1);
    expect(res.json).toHaveBeenCalledWith(response);
  });
});
