// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpClient } from '@angular/common/http';
import { PLATFORM_ID } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { NewsletterTemplateManifest } from '@lfx-one/shared/interfaces';
import { Subject, of, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { NewsletterManifestService } from './newsletter-manifest.service';
import { ProjectContextService } from './project-context.service';

const MANIFEST: NewsletterTemplateManifest = {
  wrapper_key: 'default',
  blocks: [
    { block_type: 'hero', label: 'Hero', schema: {} },
    { block_type: 'cta', label: 'Call to action', schema: {} },
  ],
};

function configure(platform: 'browser' | 'server', httpGet: ReturnType<typeof vi.fn>, projectUid: string | null = 'proj-123'): NewsletterManifestService {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    providers: [
      { provide: PLATFORM_ID, useValue: platform },
      { provide: HttpClient, useValue: { get: httpGet } },
      { provide: ProjectContextService, useValue: { activeContextUid: () => projectUid } },
    ],
  });
  return TestBed.inject(NewsletterManifestService);
}

describe('NewsletterManifestService', () => {
  let httpGet: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    httpGet = vi.fn().mockReturnValue(of(MANIFEST));
  });

  it('loads a manifest, publishes it, and clears the loading state', () => {
    const service = configure('browser', httpGet);
    service.load('default').subscribe();

    expect(httpGet).toHaveBeenCalledWith('/api/projects/proj-123/newsletters/templates/default/manifest');
    expect(service.manifest()).toEqual(MANIFEST);
    expect(service.loading()).toBe(false);
    expect(service.error()).toBe(false);
  });

  it('getBlock resolves a block by its block_type and returns undefined otherwise', () => {
    const service = configure('browser', httpGet);
    service.load('default').subscribe();

    expect(service.getBlock('cta')?.label).toBe('Call to action');
    expect(service.getBlock('missing')).toBeUndefined();
  });

  it('caches the request per key — a repeat load does not re-fetch', () => {
    const service = configure('browser', httpGet);
    service.load('default').subscribe();
    service.load('default').subscribe();
    expect(httpGet).toHaveBeenCalledTimes(1);
  });

  it('sets the error state and leaves the manifest null on a failed load', () => {
    httpGet.mockReturnValue(throwError(() => new Error('boom')));
    const service = configure('browser', httpGet);
    service.load('default').subscribe();

    expect(service.error()).toBe(true);
    expect(service.manifest()).toBeNull();
    expect(service.loading()).toBe(false);
  });

  it('flags an error when there is no active project context', () => {
    const service = configure('browser', httpGet, null);
    service.load('default').subscribe();

    expect(httpGet).not.toHaveBeenCalled();
    expect(service.error()).toBe(true);
  });

  it('loadTemplates publishes the catalog', () => {
    httpGet.mockReturnValue(of({ templates: [{ key: 'default', label: 'Default' }] }));
    const service = configure('browser', httpGet);
    service.loadTemplates().subscribe();

    expect(service.templates()).toEqual([{ key: 'default', label: 'Default' }]);
  });

  it('loadTemplates loads for the owning project, caches per project, and refetches when it changes', () => {
    httpGet.mockReturnValue(of({ templates: [{ key: 'default', label: 'Default' }] }));
    const service = configure('browser', httpGet, 'ambient-proj');

    service.loadTemplates('owning-proj').subscribe();
    service.loadTemplates('owning-proj').subscribe();
    expect(httpGet).toHaveBeenCalledTimes(1);
    expect(httpGet).toHaveBeenCalledWith('/api/projects/owning-proj/newsletters/templates');

    service.loadTemplates('other-proj').subscribe();
    expect(httpGet).toHaveBeenCalledTimes(2);
    expect(httpGet).toHaveBeenLastCalledWith('/api/projects/other-proj/newsletters/templates');
  });

  it('loadTemplates ignores a late response for a project that is no longer current', () => {
    const first = new Subject<{ templates: { key: string; label: string }[] }>();
    httpGet.mockReturnValueOnce(first.asObservable()).mockReturnValueOnce(of({ templates: [{ key: 'b', label: 'B' }] }));
    const service = configure('browser', httpGet, 'ambient-proj');

    service.loadTemplates('proj-a').subscribe();
    service.loadTemplates('proj-b').subscribe();
    first.next({ templates: [{ key: 'a', label: 'A' }] });

    expect(service.templates()).toEqual([{ key: 'b', label: 'B' }]);
  });

  it('clears loading when a remounted composer replays a manifest whose first subscriber left early', () => {
    const response = new Subject<unknown>();
    httpGet.mockReturnValue(response.asObservable());
    const service = configure('browser', httpGet);

    // The first composer unsubscribes before the response lands.
    service.load('default').subscribe().unsubscribe();
    response.next({ wrapper_key: 'default', blocks: [] });
    response.complete();

    // A remount loads the same key from the cache.
    service.load('default').subscribe();
    expect(service.loading()).toBe(false);
    expect(service.manifest()).not.toBeNull();
  });

  it('loadTemplates clears the previous project list on a switch, and an old failure does not drop the new request', () => {
    const failing = new Subject<{ templates: { key: string; label: string }[] }>();
    const fresh = new Subject<{ templates: { key: string; label: string }[] }>();
    httpGet
      .mockReturnValueOnce(of({ templates: [{ key: 'a', label: 'A' }] }))
      .mockReturnValueOnce(failing.asObservable())
      .mockReturnValueOnce(fresh.asObservable());
    const service = configure('browser', httpGet, 'ambient-proj');

    service.loadTemplates('proj-a').subscribe();
    expect(service.templates()).toEqual([{ key: 'a', label: 'A' }]);

    service.loadTemplates('proj-b').subscribe();
    expect(service.templates()).toEqual([]);

    service.loadTemplates('proj-c').subscribe();
    failing.error(new Error('boom'));
    // proj-c's request is still the cached one, so no new fetch is made.
    service.loadTemplates('proj-c').subscribe();
    expect(httpGet).toHaveBeenCalledTimes(3);
    fresh.next({ templates: [{ key: 'c', label: 'C' }] });
    expect(service.templates()).toEqual([{ key: 'c', label: 'C' }]);
  });

  it('load scopes the manifest to the owning project UID when one is passed, over the ambient lens', () => {
    const service = configure('browser', httpGet, 'ambient-proj');
    service.load('default', 'owning-proj').subscribe();

    expect(httpGet).toHaveBeenCalledWith('/api/projects/owning-proj/newsletters/templates/default/manifest');
  });

  it('load falls back to the ambient lens when no owning project UID is passed', () => {
    const service = configure('browser', httpGet, 'ambient-proj');
    service.load('default').subscribe();

    expect(httpGet).toHaveBeenCalledWith('/api/projects/ambient-proj/newsletters/templates/default/manifest');
  });

  it('no-ops on the server — no fetch, null manifest', () => {
    const service = configure('server', httpGet);
    let emitted: NewsletterTemplateManifest | null | undefined;
    service.load('default').subscribe((m) => (emitted = m));

    expect(httpGet).not.toHaveBeenCalled();
    expect(emitted).toBeNull();
    expect(service.manifest()).toBeNull();
  });
});
