// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { FetchBackend, HttpRequest } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SsrBaseUrlBackend } from './ssr-base-url.backend';

describe('SsrBaseUrlBackend', () => {
  let handle: ReturnType<typeof vi.fn>;
  let backend: SsrBaseUrlBackend;
  let originalPort: string | undefined;

  beforeEach(() => {
    originalPort = process.env['PORT'];
    handle = vi.fn().mockReturnValue(of({}));

    TestBed.configureTestingModule({
      providers: [SsrBaseUrlBackend, { provide: FetchBackend, useValue: { handle } }],
    });
    backend = TestBed.inject(SsrBaseUrlBackend);
  });

  afterEach(() => {
    if (originalPort === undefined) {
      delete process.env['PORT'];
    } else {
      process.env['PORT'] = originalPort;
    }
  });

  it('rewrites /api/ requests to the internal loopback address using the configured PORT', () => {
    process.env['PORT'] = '4321';
    const req = new HttpRequest('GET', '/api/meetings/1');

    backend.handle(req);

    expect(handle).toHaveBeenCalledWith(expect.objectContaining({ url: 'http://127.0.0.1:4321/api/meetings/1' }));
  });

  it('rewrites /public/api/ requests to the internal loopback address', () => {
    process.env['PORT'] = '4321';
    const req = new HttpRequest('GET', '/public/api/meetings/1');

    backend.handle(req);

    expect(handle).toHaveBeenCalledWith(expect.objectContaining({ url: 'http://127.0.0.1:4321/public/api/meetings/1' }));
  });

  it('falls back to port 4000 when PORT is not set', () => {
    delete process.env['PORT'];
    const req = new HttpRequest('GET', '/api/meetings/1');

    backend.handle(req);

    expect(handle).toHaveBeenCalledWith(expect.objectContaining({ url: 'http://127.0.0.1:4000/api/meetings/1' }));
  });

  it('leaves requests outside /api/ and /public/api/ untouched', () => {
    const req = new HttpRequest('GET', '/assets/logo.svg');

    backend.handle(req);

    expect(handle).toHaveBeenCalledWith(expect.objectContaining({ url: '/assets/logo.svg' }));
  });

  it('rewrites /api/ requests already absolutized to the public origin, as done by relativeUrlsTransformerInterceptorFn', () => {
    process.env['PORT'] = '4321';
    const req = new HttpRequest('GET', 'https://lfx.example.org/api/meetings/1?occurrence=2');

    backend.handle(req);

    expect(handle).toHaveBeenCalledWith(expect.objectContaining({ url: 'http://127.0.0.1:4321/api/meetings/1?occurrence=2' }));
  });

  it('leaves absolutized requests outside /api/ and /public/api/ untouched', () => {
    const req = new HttpRequest('GET', 'https://lfx.example.org/assets/logo.svg');

    backend.handle(req);

    expect(handle).toHaveBeenCalledWith(expect.objectContaining({ url: 'https://lfx.example.org/assets/logo.svg' }));
  });
});
