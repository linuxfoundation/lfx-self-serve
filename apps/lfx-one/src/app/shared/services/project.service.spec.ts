// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpClient } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { Project } from '@lfx-one/shared/interfaces';
import { of, Subject, throwError } from 'rxjs';
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

describe('ProjectService.getProject', () => {
  let service: ProjectService;
  let httpGet: ReturnType<typeof vi.fn>;

  const projectA = { uid: 'uid-a', slug: 'slug-a', name: 'Project A' } as Project;

  beforeEach(() => {
    httpGet = vi.fn().mockReturnValue(of(projectA));
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

  it('caches a successful lookup so a second call for the same key shares one request', () => {
    const results: (Project | null)[] = [];
    service.getProject('slug-a', false).subscribe((p) => results.push(p));
    service.getProject('slug-a', false).subscribe((p) => results.push(p));
    expect(httpGet).toHaveBeenCalledTimes(1);
    expect(httpGet).toHaveBeenCalledWith('/api/projects/slug-a', { params: undefined });
    expect(results).toEqual([projectA, projectA]);
  });

  it('evicts the cache entry on error so the next getProject call re-fetches instead of replaying null', () => {
    // Plain Error (not HttpErrorResponse) — the failure path under test is the same either way.
    httpGet.mockReturnValueOnce(throwError(() => new Error('network-error')));
    let first: Project | null | undefined;
    service.getProject('slug-a', false).subscribe((p) => (first = p));
    expect(first).toBeNull();

    // The errored entry must be gone: the next lookup issues a fresh HTTP request
    // rather than replaying the cached null for the rest of the session.
    let second: Project | null | undefined;
    service.getProject('slug-a', false).subscribe((p) => (second = p));
    expect(httpGet).toHaveBeenCalledTimes(2);
    expect(second).toEqual(projectA);
  });

  it('evicts via the upstream error tap even when the error lands with zero downstream subscribers', () => {
    const source = new Subject<Project>();
    httpGet.mockReturnValueOnce(source.asObservable());

    // Subscribe then unsubscribe before the error lands — a canceled navigation.
    // shareReplay (refCount: false) keeps the source subscription alive, so the error
    // arrives with no downstream subscriber to run the post-shareReplay eviction tap.
    service.getProject('slug-a', false).subscribe().unsubscribe();
    source.error(new Error('network-error'));

    // Without the upstream tap({ error }) eviction, the poisoned entry would stay
    // cached and replay null here instead of re-fetching.
    let result: Project | null | undefined;
    service.getProject('slug-a', false).subscribe((p) => (result = p));
    expect(httpGet).toHaveBeenCalledTimes(2);
    expect(result).toEqual(projectA);
  });
});
