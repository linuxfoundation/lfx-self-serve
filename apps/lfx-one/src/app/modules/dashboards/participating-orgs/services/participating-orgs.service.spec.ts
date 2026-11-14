// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpErrorResponse, provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting, type TestRequest } from '@angular/common/http/testing';
import { PLATFORM_ID } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { PROJECT_PARTICIPATING_ORGS_EXPORT_FALLBACK_FILENAME, PROJECT_PARTICIPATING_ORGS_EXPORT_TRUNCATED_HEADER } from '@lfx-one/shared/constants';
import type { ProjectParticipatingOrgsExportFilters, ProjectParticipatingOrgsQuery } from '@lfx-one/shared/interfaces';
import { MessageService } from 'primeng/api';
import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from 'vitest';

import { ParticipatingOrgsService } from './participating-orgs.service';

const SLUG = 'synthetic-project';
const BASE = `/api/projects/${SLUG}/participating-orgs`;
const FILTERS: ProjectParticipatingOrgsExportFilters = { range: '12mo', segment: 'members', sort: 'commits', dir: 'desc' };

describe('ParticipatingOrgsService', () => {
  let service: ParticipatingOrgsService;
  let http: HttpTestingController;
  let add: Mock;
  let consoleError: Mock;
  let createObjectURL: Mock;
  let downloads: string[];
  const originalCreateObjectURL = URL.createObjectURL;
  const originalRevokeObjectURL = URL.revokeObjectURL;

  function setup(platform: 'browser' | 'server' = 'browser'): void {
    TestBed.configureTestingModule({
      providers: [
        ParticipatingOrgsService,
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: MessageService, useValue: { add } },
        { provide: PLATFORM_ID, useValue: platform },
      ],
    });
    service = TestBed.inject(ParticipatingOrgsService);
    http = TestBed.inject(HttpTestingController);
  }

  function exportRequest(): TestRequest {
    return http.expectOne((req) => req.url === `${BASE}/export`);
  }

  beforeEach(() => {
    add = vi.fn();
    consoleError = vi.fn();
    vi.spyOn(console, 'error').mockImplementation(consoleError);
    // The object URL is revoked on a deferred timer; flush it before the stubs are restored.
    vi.useFakeTimers({ toFake: ['setTimeout'] });
    downloads = [];
    createObjectURL = vi.fn(() => 'blob:http://localhost/synthetic-export');
    // jsdom has no object-URL support; the download helper only needs a blob: URL back.
    URL.createObjectURL = createObjectURL;
    URL.revokeObjectURL = vi.fn();
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      downloads.push(this.download);
    });
  });

  afterEach(() => {
    http.verify();
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
    URL.createObjectURL = originalCreateObjectURL;
    URL.revokeObjectURL = originalRevokeObjectURL;
    vi.restoreAllMocks();
  });

  it('sends every list filter, encoding user-typed search strictly', () => {
    setup();
    const query: ProjectParticipatingOrgsQuery = { ...FILTERS, search: 'acme+co', tier: 'Gold', pageSize: 50, offset: 100 };

    service.getPage(SLUG, query).subscribe();

    const req = http.expectOne((request) => request.url === BASE);
    expect(req.request.urlWithParams).toBe(`${BASE}?range=12mo&segment=members&sort=commits&dir=desc&search=acme%2Bco&tier=Gold&pageSize=50&offset=100`);
    req.flush({ rows: [], totalRecords: 0, foundationSlug: null });
  });

  it('omits an empty search and an absent tier', () => {
    setup();

    service.getPage(SLUG, { ...FILTERS, search: '', pageSize: 25, offset: 0 }).subscribe();

    const req = http.expectOne((request) => request.url === BASE);
    expect(req.request.params.has('search')).toBe(false);
    expect(req.request.params.has('tier')).toBe(false);
    req.flush({ rows: [], totalRecords: 0, foundationSlug: null });
  });

  it('logs a failed read and hands the error to the caller', () => {
    setup();
    let received: unknown;

    service.getSummary(SLUG, '12mo').subscribe({ error: (error: unknown) => (received = error) });
    http.expectOne((request) => request.url === `${BASE}/summary`).flush(null, { status: 503, statusText: 'Service Unavailable' });

    expect((received as HttpErrorResponse).status).toBe(503);
    expect(consoleError).toHaveBeenCalledWith('[participating-orgs] getSummary failed', expect.objectContaining({ slug: SLUG }));
  });

  it('saves nothing and says so when no company matches (204)', () => {
    setup();

    service.exportCsv(SLUG, FILTERS).subscribe();
    exportRequest().flush(null, { status: 204, statusText: 'No Content' });

    expect(downloads).toEqual([]);
    expect(add).toHaveBeenCalledWith(expect.objectContaining({ severity: 'info' }));
  });

  it.each<{ label: string; headers: Record<string, string>; expected: string }>([
    {
      label: 'the name the server sends',
      headers: { 'Content-Disposition': 'attachment; filename="participating-orgs-synthetic-project-12mo-2026-10-16.csv"' },
      expected: 'participating-orgs-synthetic-project-12mo-2026-10-16.csv',
    },
    { label: 'the fallback name when the server sends none', headers: {}, expected: PROJECT_PARTICIPATING_ORGS_EXPORT_FALLBACK_FILENAME },
  ])('saves the CSV under $label', ({ headers, expected }) => {
    setup();

    service.exportCsv(SLUG, FILTERS).subscribe();
    exportRequest().flush(new Blob(['Company\nAcme Motors\n'], { type: 'text/csv' }), { headers });

    expect(downloads).toEqual([expected]);
    expect(add).not.toHaveBeenCalled();
  });

  it('still saves a capped export, with a warning', () => {
    setup();

    service.exportCsv(SLUG, FILTERS).subscribe();
    exportRequest().flush(new Blob(['Company\n'], { type: 'text/csv' }), { headers: { [PROJECT_PARTICIPATING_ORGS_EXPORT_TRUNCATED_HEADER]: 'true' } });

    expect(downloads).toHaveLength(1);
    expect(add).toHaveBeenCalledWith(expect.objectContaining({ severity: 'warn' }));
  });

  it('logs a failed export and toasts an error instead of erroring', () => {
    setup();
    const completed = vi.fn();

    service.exportCsv(SLUG, FILTERS).subscribe({ complete: completed });
    exportRequest().flush(null, { status: 500, statusText: 'Server Error' });

    expect(completed).toHaveBeenCalled();
    expect(downloads).toEqual([]);
    expect(consoleError).toHaveBeenCalledWith('[participating-orgs] export failed', expect.objectContaining({ slug: SLUG }));
    expect(add).toHaveBeenCalledWith(expect.objectContaining({ severity: 'error' }));
  });

  it('reads nothing when rendered on the server', () => {
    setup('server');

    service.exportCsv(SLUG, FILTERS).subscribe();

    http.expectNone((request) => request.url === `${BASE}/export`);
    expect(createObjectURL).not.toHaveBeenCalled();
  });
});
