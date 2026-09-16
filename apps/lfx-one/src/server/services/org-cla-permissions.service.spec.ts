// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import '@angular/compiler';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Request } from 'express';

const { gatewayFetch, getUserServiceBaseUrl, loggerWarning } = vi.hoisted(() => ({
  gatewayFetch: vi.fn(),
  getUserServiceBaseUrl: vi.fn(() => 'https://gw.test/user-service/v1'),
  loggerWarning: vi.fn(),
}));

vi.mock('../helpers/gateway-fetch.helper', () => ({ gatewayFetch }));
vi.mock('../helpers/api-gateway.helper', () => ({ getUserServiceBaseUrl }));
vi.mock('./logger.service', () => ({
  logger: { warning: loggerWarning, info: vi.fn(), error: vi.fn(), debug: vi.fn(), startOperation: vi.fn(() => 0), success: vi.fn() },
}));

import { OrgClaPermissionsService } from './org-cla-permissions.service';

const COMPANY = '0014100000Te2ovAAB';
const OTHER_COMPANY = '0014100000OtherOrgAA';
const PROJECT = 'a09410000182dD2AAI';
const SIGN_PAIR = `self_serve_request_corporate_signature:create:project|organization:${PROJECT}|${COMPANY}`;
const APPROVAL_PAIR = `signature_approval_list:update:project|organization:${PROJECT}|${COMPANY}`;

describe('OrgClaPermissionsService', () => {
  const service = new OrgClaPermissionsService();
  const req = {} as Request;

  beforeEach(() => {
    vi.clearAllMocks();
    getUserServiceBaseUrl.mockReturnValue('https://gw.test/user-service/v1');
  });

  it('POSTs the interpolated Sign string for a pair-level check', async () => {
    gatewayFetch.mockResolvedValue({ permissions: { [SIGN_PAIR]: true } });

    await expect(service.check(req, COMPANY, 'sign', PROJECT)).resolves.toBe(true);

    expect(gatewayFetch).toHaveBeenCalledWith(
      req,
      'https://gw.test/user-service/v1/me/permissions/checks',
      expect.objectContaining({
        method: 'POST',
        body: { permissions: [SIGN_PAIR] },
      })
    );
  });

  it('POSTs the approval-list update string', async () => {
    gatewayFetch.mockResolvedValue({ permissions: { [APPROVAL_PAIR]: true } });

    await expect(service.check(req, COMPANY, 'approval-list-update', PROJECT)).resolves.toBe(true);
    expect(gatewayFetch.mock.calls[0][2]).toEqual(expect.objectContaining({ body: { permissions: [APPROVAL_PAIR] } }));
  });

  it('GETs the permission list for header Sign when no project is named', async () => {
    gatewayFetch.mockResolvedValue({
      Permissions: [
        {
          Resource: 'self_serve_request_corporate_signature',
          Actions: ['create'],
          Scopes: [{ ID: [`${PROJECT}|${OTHER_COMPANY}`, `${PROJECT}|${COMPANY}`], Type: 'project|organization' }],
        },
      ],
    });

    await expect(service.check(req, COMPANY, 'sign')).resolves.toBe(true);
    expect(gatewayFetch).toHaveBeenCalledWith(
      req,
      'https://gw.test/user-service/v1/me/permissions',
      expect.objectContaining({ operation: 'list_org_cla_permissions' })
    );
  });

  it('fails closed when ACS omits the permission', async () => {
    gatewayFetch.mockResolvedValue({ permissions: {} });
    await expect(service.check(req, COMPANY, 'sign', PROJECT)).resolves.toBe(false);
  });

  it('fails closed when ACS throws', async () => {
    gatewayFetch.mockRejectedValue(new Error('timeout'));
    await expect(service.check(req, COMPANY, 'sign', PROJECT)).resolves.toBe(false);
  });

  it('fails closed when approval-list-update has no project id', async () => {
    await expect(service.check(req, COMPANY, 'approval-list-update')).resolves.toBe(false);
    expect(gatewayFetch).not.toHaveBeenCalled();
  });

  it('fails closed on a malformed project id rather than interpolating it', async () => {
    await expect(service.check(req, COMPANY, 'sign', 'not-an-sfid')).resolves.toBe(false);
    expect(gatewayFetch).not.toHaveBeenCalled();
  });
});
