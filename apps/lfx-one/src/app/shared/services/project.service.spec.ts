// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpClient } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ProjectService } from './project.service';

describe('ProjectService.getProjectSlugs', () => {
  let service: ProjectService;
  let httpGet: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    httpGet = vi.fn().mockReturnValue(of(['slug-a', 'slug-b']));
    TestBed.configureTestingModule({
      providers: [
        {
          provide: HttpClient,
          useValue: { get: httpGet, post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn() },
        },
      ],
    });
    service = TestBed.inject(ProjectService);
  });

  afterEach(() => {
    TestBed.resetTestingModule();
  });

  it('issues GET /api/projects/slugs and returns the slug array', () => {
    let result: string[] = [];
    service.getProjectSlugs().subscribe((slugs) => (result = slugs));
    expect(httpGet).toHaveBeenCalledWith('/api/projects/slugs');
    expect(result).toEqual(['slug-a', 'slug-b']);
  });

  it('reuses the cached observable on a second call without issuing another request', () => {
    const results: string[][] = [];
    service.getProjectSlugs().subscribe((v) => results.push(v));
    service.getProjectSlugs().subscribe((v) => results.push(v));
    expect(httpGet).toHaveBeenCalledTimes(1);
    expect(results).toEqual([['slug-a', 'slug-b'], ['slug-a', 'slug-b']]);
  });

  it('evicts slugsCache$ on error so the next caller gets a fresh HTTP attempt', () => {
    // Use a plain Error (not HttpErrorResponse) so retryTransientHttpError passes it through
    // immediately — only status-0/408/429/5xx HttpErrorResponse values are retried.
    httpGet.mockReturnValueOnce(throwError(() => new Error('network-error')));
    service.getProjectSlugs().subscribe();

    // tap({ error }) fires synchronously (throwError is synchronous), so the cache is already
    // null by the time we assert. The next call must issue a new request.
    expect((service as unknown as { slugsCache$: unknown }).slugsCache$).toBeNull();

    httpGet.mockReturnValueOnce(of(['slug-c']));
    service.getProjectSlugs().subscribe();
    expect(httpGet).toHaveBeenCalledTimes(2);
  });

  it('falls back to [] on error so callers never receive an error notification', () => {
    httpGet.mockReturnValueOnce(throwError(() => new Error('network-error')));
    let result: string[] = ['sentinel'];
    service.getProjectSlugs().subscribe((slugs) => (result = slugs));
    expect(result).toEqual([]);
  });
});
