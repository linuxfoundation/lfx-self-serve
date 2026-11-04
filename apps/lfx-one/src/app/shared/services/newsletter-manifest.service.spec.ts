// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpClient } from '@angular/common/http';
import { PLATFORM_ID } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { NewsletterTemplateManifest } from '@lfx-one/shared/interfaces';
import { of, throwError } from 'rxjs';
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
