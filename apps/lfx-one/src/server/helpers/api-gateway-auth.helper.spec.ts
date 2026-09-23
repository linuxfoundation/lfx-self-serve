// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import '@angular/compiler';

import type { Request } from 'express';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { apiGatewayAuthRequiredError, isDocumentNavigation, normalizeApiGatewayReturnTo } from './api-gateway-auth.helper';

describe('Gateway authorization required error', () => {
  it('constructs only the recoverable 403 response with a fixed local authorize URL', () => {
    const error = apiGatewayAuthRequiredError('synthetic_operation', 'synthetic_service');
    expect(error).toMatchObject({
      statusCode: 403,
      code: 'API_GATEWAY_AUTH_REQUIRED',
      operation: 'synthetic_operation',
      service: 'synthetic_service',
    });
    expect(error.toResponse()).toEqual({
      error: 'API Gateway authorization required. Open /api-gateway/auth/start in your browser, then retry the operation.',
      code: 'API_GATEWAY_AUTH_REQUIRED',
      service: 'synthetic_service',
      details: { authorize_url: '/api-gateway/auth/start' },
    });
  });

  it('does not add service metadata when the caller supplies only an operation', () => {
    const error = apiGatewayAuthRequiredError('synthetic_operation');
    expect(error.operation).toBe('synthetic_operation');
    expect(error.toResponse()).not.toHaveProperty('service');
  });
});

describe('Gateway authorization navigation', () => {
  beforeEach(() => vi.stubEnv('PCC_BASE_URL', 'https://self-serve.example'));
  afterEach(() => vi.unstubAllEnvs());

  it.each([
    'https://outside.example/org',
    'https://self-serve.example.outside.example/org',
    '//outside.example/org',
    '/\\outside.example',
    '/%5coutside.example',
    '/%2foutside.example',
    '/%00control',
    '/%1fcontrol',
    '/%7fcontrol',
    'https://user:password@self-serve.example/profile',
    'javascript:alert(1)',
    '/login?returnTo=/api-gateway/callback',
    '/logout',
    '/api/profile/developer',
    '/public/api/projects',
    '/api-gateway/callback?code=secret',
    '/api-gateway/auth/start',
    '/API-GATEWAY/CALLBACK/',
    '/%61pi-gateway/callback',
    '/crowdfunding/callback',
    '/social/callback',
    '/passwordless/callback',
    '/callback',
    '/auth-error',
    '/bad%ZZ',
    '',
    ['/', '/org/acme'],
    undefined,
  ])('rejects unsafe or non-replayable returnTo %j', (raw) => {
    expect(normalizeApiGatewayReturnTo(raw)).toBe('/');
  });

  it('preserves safe paths and ordinary query parameters while removing only the Gateway error marker', () => {
    expect(normalizeApiGatewayReturnTo('/org/acme/easycla?tab=agreements#active')).toBe('/org/acme/easycla?tab=agreements#active');
    expect(normalizeApiGatewayReturnTo('https://self-serve.example/profile?tab=email')).toBe('/profile?tab=email');
    expect(normalizeApiGatewayReturnTo('/org/acme?api_gateway_error=old&code=invite-code&state=business-state&tab=members')).toBe(
      '/org/acme?code=invite-code&state=business-state&tab=members'
    );
  });

  it.each([
    ['GET', 'text/html,application/xhtml+xml', false, 'navigate', 'document', true],
    ['GET', 'text/html', false, undefined, undefined, true],
    ['POST', 'text/html', false, 'navigate', 'document', false],
    ['PUT', 'text/html', false, 'navigate', 'document', false],
    ['GET', '*/*', false, undefined, undefined, false],
    ['GET', 'application/json', false, undefined, undefined, false],
    ['GET', 'text/html', true, undefined, undefined, false],
    ['GET', 'text/html', false, 'cors', 'empty', false],
    ['GET', 'text/html', false, 'navigate', 'iframe', false],
  ])('classifies %s %s xhr=%s mode=%s dest=%s as navigation=%s', (method, accept, xhr, mode, destination, expected) => {
    const headers: Record<string, string | undefined> = { Accept: accept, 'Sec-Fetch-Mode': mode, 'Sec-Fetch-Dest': destination };
    const req = { method, xhr, get: (name: string) => headers[name] } as Request;
    expect(isDocumentNavigation(req)).toBe(expected);
  });
});
