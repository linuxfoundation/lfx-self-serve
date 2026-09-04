// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it, vi } from 'vitest';

import type { Request } from 'express';

import { OrgClaService } from './org-cla.service';

describe('OrgClaService.listClaGroups', () => {
  it('returns an empty list for the grant-checked org and does not read a client-passed user id', async () => {
    const req = { query: { userId: 'someone-else' }, body: { userID: 'someone-else' } } as unknown as Request;

    const result = await new OrgClaService().listClaGroups(req, '0014100000Te2ovAAB');

    expect(result).toEqual({ orgUid: '0014100000Te2ovAAB', claGroups: [] });
  });

  it('does not call EasyCLA v4', async () => {
    const gatewayFetch = vi.fn();

    await new OrgClaService().listClaGroups({} as Request, '0014100000Te2ovAAB');

    expect(gatewayFetch).not.toHaveBeenCalled();
  });
});
