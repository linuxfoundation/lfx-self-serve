// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { DOCUMENT } from '@angular/common';
import { HttpErrorResponse, HttpHandlerFn, HttpHeaders, HttpRequest, HttpResponse } from '@angular/common/http';
import { PLATFORM_ID } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { apiGatewayAuthInterceptor } from './api-gateway-auth.interceptor';

describe('apiGatewayAuthInterceptor', () => {
  let location: Pick<Location, 'pathname' | 'search' | 'hash' | 'href'>;

  function run(failure: unknown, method = 'GET', url = '/api/orgs/acme/clas') {
    const req = new HttpRequest(method, url, method === 'GET' ? null : { selectedGroup: 'group-one' }, { withCredentials: true });
    const next = vi.fn<HttpHandlerFn>().mockReturnValue(throwError(() => failure));
    const observer = { next: vi.fn(), error: vi.fn(), complete: vi.fn() };
    TestBed.runInInjectionContext(() => apiGatewayAuthInterceptor(req, next)).subscribe(observer);
    return { req, next, observer };
  }

  function challenge() {
    return new HttpErrorResponse({ status: 403, error: { code: 'API_GATEWAY_AUTH_REQUIRED' } });
  }

  beforeEach(() => {
    location = { pathname: '/org/acme/easycla', search: '?tab=agreements&code=business-code', hash: '#active', href: '' };
    TestBed.configureTestingModule({
      providers: [
        { provide: DOCUMENT, useValue: { location } },
        { provide: PLATFORM_ID, useValue: 'browser' },
      ],
    });
  });

  it.each(['GET', 'POST', 'PUT', 'PATCH', 'DELETE'])('starts authorization without replaying the %s request', (method) => {
    const { req, next, observer } = run(challenge(), method);
    expect(location.href).toBe('/api-gateway/auth/start?returnTo=%2Forg%2Facme%2Feasycla%3Ftab%3Dagreements%26code%3Dbusiness-code%23active');
    expect(next).toHaveBeenCalledExactlyOnceWith(req);
    expect(req.method).toBe(method);
    expect(req.body).toEqual(method === 'GET' ? null : { selectedGroup: 'group-one' });
    expect(req.withCredentials).toBe(true);
    expect(observer.next).not.toHaveBeenCalled();
    expect(observer.error).not.toHaveBeenCalled();
    expect(observer.complete).toHaveBeenCalledOnce();
  });

  it('uses the fixed local authorization route rather than a supplied redirect URL', () => {
    run(new HttpErrorResponse({ status: 403, error: { code: 'API_GATEWAY_AUTH_REQUIRED', details: { authorize_url: 'https://outside.example/' } } }));
    expect(location.href).toMatch(/^\/api-gateway\/auth\/start\?/);
    expect(location.href).not.toContain('outside.example');
  });

  it.each(['?api_gateway_error=authorization_failed', '?api_gateway_error=invalid_state', '?api_gateway_error='])(
    'surfaces a failed authorization rather than looping (%s)',
    (search) => {
      location.search = search;
      const error = challenge();
      const { observer } = run(error);
      expect(location.href).toBe('');
      expect(observer.error).toHaveBeenCalledExactlyOnceWith(error);
      expect(observer.complete).not.toHaveBeenCalled();
    }
  );

  it.each([
    [401, { code: 'API_GATEWAY_AUTH_REQUIRED' }],
    [403, { code: 'FORBIDDEN' }],
    [403, { code: 'CLA_GROUP_MISMATCH' }],
    [403, { code: 'IMPERSONATION_READ_ONLY' }],
    [503, { code: 'API_GATEWAY_UNAVAILABLE' }],
    [500, { code: 'API_GATEWAY_AUTH_REQUIRED' }],
    [403, null],
    [403, undefined],
    [403, 'API_GATEWAY_AUTH_REQUIRED'],
    [403, [{ code: 'API_GATEWAY_AUTH_REQUIRED' }]],
  ])('leaves unrelated HTTP %s errors unchanged (%j)', (status, body) => {
    const error = new HttpErrorResponse({ status, error: body });
    const { observer } = run(error);
    expect(location.href).toBe('');
    expect(observer.error).toHaveBeenCalledExactlyOnceWith(error);
  });

  it.each(['/public/api/projects', '/api-gateway/auth/start', '/api-gateway/callback', 'https://outside.example/api/clas', '//outside.example/api/clas'])(
    'does not intercept non-protected or external requests (%s)',
    (url) => {
      const error = challenge();
      const { observer } = run(error, 'GET', url);
      expect(location.href).toBe('');
      expect(observer.error).toHaveBeenCalledExactlyOnceWith(error);
    }
  );

  it('never reads browser location during SSR', () => {
    const getLocation = vi.fn(() => {
      throw new Error('Browser location accessed during SSR');
    });
    TestBed.overrideProvider(PLATFORM_ID, { useValue: 'server' });
    TestBed.overrideProvider(DOCUMENT, { useValue: Object.defineProperty({}, 'location', { get: getLocation }) });
    const error = challenge();
    const { observer } = run(error);
    expect(getLocation).not.toHaveBeenCalled();
    expect(observer.error).toHaveBeenCalledExactlyOnceWith(error);
  });

  it('preserves successful responses and request headers', () => {
    const req = new HttpRequest('GET', '/api/orgs/acme/clas', {
      withCredentials: true,
      headers: new HttpHeaders({ 'X-Request-ID': 'preserved' }),
    });
    const response = new HttpResponse({ status: 200, body: { signatures: [] } });
    const next = vi.fn<HttpHandlerFn>().mockReturnValue(of(response));
    const observer = { next: vi.fn(), error: vi.fn(), complete: vi.fn() };
    TestBed.runInInjectionContext(() => apiGatewayAuthInterceptor(req, next)).subscribe(observer);
    expect(next).toHaveBeenCalledExactlyOnceWith(req);
    expect(observer.next).toHaveBeenCalledExactlyOnceWith(response);
    expect(observer.error).not.toHaveBeenCalled();
    expect(req.headers.get('X-Request-ID')).toBe('preserved');
    expect(location.href).toBe('');
  });

  it('does not turn non-HTTP exceptions into authorization redirects', () => {
    const error = new Error('Unrelated failure');
    const { observer } = run(error);
    expect(observer.error).toHaveBeenCalledExactlyOnceWith(error);
    expect(location.href).toBe('');
  });
});
