// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { MicroserviceError } from '../errors';
import { getGwApiBaseUrl } from './gw-api.helper';

describe('getGwApiBaseUrl', () => {
  const originalGwApiUrl = process.env['GW_API_URL'];
  const originalNodeEnv = process.env['NODE_ENV'];

  beforeEach(() => {
    delete process.env['GW_API_URL'];
  });

  afterEach(() => {
    if (originalGwApiUrl === undefined) {
      delete process.env['GW_API_URL'];
    } else {
      process.env['GW_API_URL'] = originalGwApiUrl;
    }
    process.env['NODE_ENV'] = originalNodeEnv;
  });

  it('throws a 503 MicroserviceError when GW_API_URL is unset', () => {
    expect(() => getGwApiBaseUrl('gw_proxy_request')).toThrow(MicroserviceError);
    try {
      getGwApiBaseUrl('gw_proxy_request');
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(MicroserviceError);
      expect((error as MicroserviceError).statusCode).toBe(503);
      expect((error as MicroserviceError).code).toBe('GW_API_URL_MISCONFIGURED');
    }
  });

  it('throws when GW_API_URL is set but empty/whitespace-only', () => {
    process.env['GW_API_URL'] = '   ';
    expect(() => getGwApiBaseUrl('gw_proxy_request')).toThrow(MicroserviceError);
  });

  it('throws when GW_API_URL has a trailing slash', () => {
    process.env['NODE_ENV'] = 'production';
    process.env['GW_API_URL'] = 'https://gw.example.com/';
    expect(() => getGwApiBaseUrl('gw_proxy_request')).toThrow(/trailing slash/);
  });

  it.each([
    ['a scheme with no host', 'https://'],
    ['a bare hostname with no scheme', 'gw.example.com'],
    ['nonsense', 'not a url at all'],
  ])('reports %s as a misconfiguration, not a 500', (_label, value) => {
    // Each of these passed the old startsWith() check (or, in dev, no check at all) and then threw
    // a bare TypeError from `new URL()` in the controller — surfacing as a generic 500 instead of
    // the 503 this function exists to produce.
    process.env['NODE_ENV'] = 'development';
    process.env['GW_API_URL'] = value;
    expect(() => getGwApiBaseUrl('gw_proxy_request')).toThrow(expect.objectContaining({ statusCode: 503, code: 'GW_API_URL_MISCONFIGURED' }));
  });

  it('rejects a non-http(s) scheme even in development', () => {
    process.env['NODE_ENV'] = 'development';
    process.env['GW_API_URL'] = 'file:///etc/passwd';
    expect(() => getGwApiBaseUrl('gw_proxy_request')).toThrow(/http/);
  });

  it('throws when GW_API_URL is non-https outside dev/local/test NODE_ENV', () => {
    process.env['NODE_ENV'] = 'production';
    process.env['GW_API_URL'] = 'http://gw.example.com';
    expect(() => getGwApiBaseUrl('gw_proxy_request')).toThrow(/https/);
  });

  it('allows non-https GW_API_URL when NODE_ENV is development', () => {
    process.env['NODE_ENV'] = 'development';
    process.env['GW_API_URL'] = 'http://localhost:5050';
    expect(getGwApiBaseUrl('gw_proxy_request')).toBe('http://localhost:5050');
  });

  it('allows non-https GW_API_URL when NODE_ENV is local', () => {
    process.env['NODE_ENV'] = 'local';
    process.env['GW_API_URL'] = 'http://localhost:5050';
    expect(getGwApiBaseUrl('gw_proxy_request')).toBe('http://localhost:5050');
  });

  it('returns the trimmed URL unchanged when valid', () => {
    process.env['NODE_ENV'] = 'production';
    process.env['GW_API_URL'] = '  https://gw.example.com  ';
    expect(getGwApiBaseUrl('gw_proxy_request')).toBe('https://gw.example.com');
  });
});
