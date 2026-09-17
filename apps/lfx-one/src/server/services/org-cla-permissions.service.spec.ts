// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import '@angular/compiler';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Request } from 'express';

const { gatewayFetch, getUserServiceBaseUrl, loggerWarning, isImpersonating } = vi.hoisted(() => ({
  gatewayFetch: vi.fn(),
  getUserServiceBaseUrl: vi.fn(() => 'https://gw.test/user-service/v1'),
  loggerWarning: vi.fn(),
  isImpersonating: vi.fn(() => false),
}));

vi.mock('../helpers/gateway-fetch.helper', () => ({ gatewayFetch }));
vi.mock('../helpers/api-gateway.helper', () => ({ getUserServiceBaseUrl }));
vi.mock('../utils/auth-helper', () => ({ isImpersonating }));
vi.mock('./logger.service', () => ({
  logger: { warning: loggerWarning, info: vi.fn(), error: vi.fn(), debug: vi.fn(), startOperation: vi.fn(() => 0), success: vi.fn() },
}));

import { OrgClaPermissionsService } from './org-cla-permissions.service';

const COMPANY = '0014100000Te2ovAAB';
const PROJECT = 'a09410000182dD2AAI';
const SIGN_PAIR = `self_serve_request_corporate_signature:create:project|organization:${PROJECT}|${COMPANY}`;
const APPROVAL_PAIR = `signature_approval_list:update:project|organization:${PROJECT}|${COMPANY}`;

describe('OrgClaPermissionsService', () => {
  const service = new OrgClaPermissionsService();
  const req = {} as Request;

  beforeEach(() => {
    vi.clearAllMocks();
    getUserServiceBaseUrl.mockReturnValue('https://gw.test/user-service/v1');
    isImpersonating.mockReturnValue(false);
  });

  it('POSTs the interpolated Sign string for a pair-level check', async () => {
    gatewayFetch.mockResolvedValue({ [SIGN_PAIR]: true });

    await expect(service.check(req, COMPANY, 'sign', PROJECT)).resolves.toBe(true);

    expect(gatewayFetch).toHaveBeenCalledWith(
      req,
      'https://gw.test/user-service/v1/me/permissions/checks',
      expect.objectContaining({
        method: 'POST',
        body: [SIGN_PAIR],
      })
    );
  });

  it('POSTs the approval-list update string', async () => {
    gatewayFetch.mockResolvedValue({ [APPROVAL_PAIR]: true });

    await expect(service.check(req, COMPANY, 'approval-list-update', PROJECT)).resolves.toBe(true);
    expect(gatewayFetch.mock.calls[0][2]).toEqual(expect.objectContaining({ body: [APPROVAL_PAIR] }));
  });

  it('fails closed when Sign has no project id rather than listing company grants', async () => {
    await expect(service.check(req, COMPANY, 'sign')).resolves.toBe(false);
    expect(gatewayFetch).not.toHaveBeenCalled();
  });

  it('fails closed when ACS omits the permission', async () => {
    gatewayFetch.mockResolvedValue({});
    await expect(service.check(req, COMPANY, 'sign', PROJECT)).resolves.toBe(false);
  });

  it('fails closed on the wrapped envelope ACS does not return', async () => {
    gatewayFetch.mockResolvedValue({ permissions: { [SIGN_PAIR]: true } });
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

  it('forwards the impersonated user token so ACS answers as the target', async () => {
    isImpersonating.mockReturnValue(true);
    const impersonated = { bearerToken: 'target-user-token' } as Request;
    gatewayFetch.mockResolvedValue({ [SIGN_PAIR]: true });

    await expect(service.check(impersonated, COMPANY, 'sign', PROJECT)).resolves.toBe(true);

    expect(gatewayFetch.mock.calls[0][2]).toEqual(expect.objectContaining({ bearerToken: 'target-user-token' }));
  });

  it('does not override the token when the caller is not impersonating', async () => {
    gatewayFetch.mockResolvedValue({ [SIGN_PAIR]: true });

    await service.check(req, COMPANY, 'sign', PROJECT);

    expect(gatewayFetch.mock.calls[0][2]).toEqual(expect.not.objectContaining({ bearerToken: expect.anything() }));
  });
});
