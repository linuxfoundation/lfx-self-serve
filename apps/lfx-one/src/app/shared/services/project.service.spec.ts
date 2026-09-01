// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpClient, HttpParams } from '@angular/common/http';
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
    let result: string[] | null = null;
    service.getProjectSlugs().subscribe((slugs) => (result = slugs));
    expect(httpGet).toHaveBeenCalledWith('/api/projects/slugs');
    expect(result).toEqual(['slug-a', 'slug-b']);
  });

  it('reuses the cached observable on a second call without issuing another request', () => {
    const results: (string[] | null)[] = [];
    service.getProjectSlugs().subscribe((v) => results.push(v));
    service.getProjectSlugs().subscribe((v) => results.push(v));
    expect(httpGet).toHaveBeenCalledTimes(1);
    expect(results).toEqual([
      ['slug-a', 'slug-b'],
      ['slug-a', 'slug-b'],
    ]);
  });

  it('evicts slugsCache$ on error so the next caller gets a fresh HTTP attempt', () => {
    // Use a plain Error (not HttpErrorResponse) so retryTransientHttpError passes it through
    // immediately — only status-0/408/429/5xx HttpErrorResponse values are retried.
    httpGet.mockReturnValueOnce(throwError(() => new Error('network-error')));
    let fallback: string[] | null = ['sentinel'];
    service.getProjectSlugs().subscribe((v) => (fallback = v));

    // tap({ error }) fires synchronously (throwError is synchronous), so the cache is already
    // null by the time we assert. The next call must issue a new request.
    // Returns null (not []) so callers can distinguish "fetch failed, skip LFX filter"
    // from "fetch succeeded, no LFX projects".
    expect(fallback).toBeNull();
    expect((service as unknown as { slugsCache$: unknown }).slugsCache$).toBeNull();

    httpGet.mockReturnValueOnce(of(['slug-c']));
    service.getProjectSlugs().subscribe();
    expect(httpGet).toHaveBeenCalledTimes(2);
  });

  it('falls back to null on error so callers can skip the LFX filter rather than filtering all affiliations out', () => {
    httpGet.mockReturnValueOnce(throwError(() => new Error('network-error')));
    let result: string[] | null = ['sentinel'];
    service.getProjectSlugs().subscribe((slugs) => (result = slugs));
    expect(result).toBeNull();
  });
});

describe('ProjectService.searchProjects', () => {
  let service: ProjectService;
  let httpGet: ReturnType<typeof vi.fn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    httpGet = vi.fn().mockReturnValue(of([]));
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
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
    errorSpy.mockRestore();
  });

  it('issues GET /api/projects/search with the query param and returns the results', () => {
    httpGet.mockReturnValueOnce(of([{ uid: 'p1', name: 'Example' }]));
    let result: unknown[] = [];
    service.searchProjects('example').subscribe((projects) => (result = projects));

    expect(httpGet).toHaveBeenCalledTimes(1);
    const [url, options] = httpGet.mock.calls[0];
    expect(url).toBe('/api/projects/search');
    expect((options.params as HttpParams).get('q')).toBe('example');
    expect(result).toEqual([{ uid: 'p1', name: 'Example' }]);
  });

  /**
   * This is the degradation contract `ProposeComponent.initDuplicateNameMatch` and
   * `ProjectPickerComponent.initResults` both rely on instead of a local `catchError` — see
   * those components' specs, and the doc comments on the `toSignal` streams that name this
   * behavior. Covered here, at the layer that actually implements it, rather than only asserted
   * indirectly through a component-level mock that could drift from the real service.
   */
  it('degrades to an empty array (and logs) on a failed search, rather than erroring the stream', () => {
    httpGet.mockReturnValueOnce(throwError(() => new Error('network-error')));
    let result: unknown[] | null = null;
    let errored = false;

    service.searchProjects('example').subscribe({
      next: (projects) => (result = projects),
      error: () => (errored = true),
    });

    expect(errored).toBe(false);
    expect(result).toEqual([]);
    expect(errorSpy).toHaveBeenCalled();
  });
});
