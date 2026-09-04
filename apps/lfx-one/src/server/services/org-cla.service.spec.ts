// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Request } from 'express';

const { gatewayFetch } = vi.hoisted(() => ({ gatewayFetch: vi.fn() }));

vi.mock('../helpers/gateway-fetch.helper', () => ({ gatewayFetch }));

const { OrgClaService } = await import('./org-cla.service');

beforeEach(() => {
  vi.clearAllMocks();
});

describe('OrgClaService.listClaGroups', () => {
  it('returns an empty list for the grant-checked org and does not read a client-passed user id', async () => {
    const req = { query: { userId: 'someone-else' }, body: { userID: 'someone-else' } } as unknown as Request;

    const result = await new OrgClaService().listClaGroups(req, '0014100000Te2ovAAB');

    expect(result).toEqual({ orgUid: '0014100000Te2ovAAB', claGroups: [] });
  });

  it('does not call EasyCLA v4', async () => {
    await new OrgClaService().listClaGroups({} as Request, '0014100000Te2ovAAB');

    expect(gatewayFetch).not.toHaveBeenCalled();
  });
});
