// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpErrorResponse, provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { PLATFORM_ID } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { FOUNDATION_PARTICIPATING_ORGS_EXPORT_TRUNCATED_HEADER } from '@lfx-one/shared/constants';
import type { FoundationParticipatingOrgsExportFilters } from '@lfx-one/shared/interfaces';
import { MessageService } from 'primeng/api';
import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from 'vitest';

import { FoundationParticipatingOrgsService } from './foundation-participating-orgs.service';

const BASE = '/api/foundation-participating-orgs';
const FILTERS: FoundationParticipatingOrgsExportFilters = {
  foundationSlug: 'synthetic-foundation',
  range: '12mo',
  segment: 'all',
  sort: 'commits',
  dir: 'desc',
};

describe('FoundationParticipatingOrgsService', () => {
  let service: FoundationParticipatingOrgsService;
  let http: HttpTestingController;
  let add: Mock;
  const originalCreate = URL.createObjectURL;
  const originalRevoke = URL.revokeObjectURL;

  function setup(platform: 'browser' | 'server' = 'browser'): void {
    TestBed.configureTestingModule({
      providers: [
        FoundationParticipatingOrgsService,
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: MessageService, useValue: { add } },
        { provide: PLATFORM_ID, useValue: platform },
      ],
    });
    service = TestBed.inject(FoundationParticipatingOrgsService);
    http = TestBed.inject(HttpTestingController);
  }

  beforeEach(() => {
    add = vi.fn();
    URL.createObjectURL = vi.fn(() => 'blob:synthetic');
    URL.revokeObjectURL = vi.fn();
  });

  afterEach(async () => {
    // The download revokes its object URL on a deferred tick; let it run before the stubs are restored, or it hits the real, missing method.
    await new Promise((resolve) => setTimeout(resolve, 0));
    URL.createObjectURL = originalCreate;
    URL.revokeObjectURL = originalRevoke;
    http?.verify();
    TestBed.resetTestingModule();
  });

  it('sends the foundation, range and only the filters that are set', () => {
    setup();
    service.getPage({ ...FILTERS, pageSize: 10, offset: 20 }).subscribe();
    const request = http.expectOne((req) => req.url === BASE);
    expect(request.request.params.get('foundationSlug')).toBe('synthetic-foundation');
    expect(request.request.params.get('offset')).toBe('20');
    expect(request.request.params.has('projectSlug')).toBe(false);
    expect(request.request.params.has('search')).toBe(false);
    expect(request.request.params.has('tier')).toBe(false);
    request.flush({ rows: [], totalRecords: 0 });
  });

  it('adds project, search and tier to the summary request when set', () => {
    setup();
    service.getSummary({ foundationSlug: 'synthetic-foundation', range: '90d', projectSlug: 'p', search: 'acme', tier: 'Gold' }).subscribe();
    const request = http.expectOne((req) => req.url === `${BASE}/summary`);
    expect(request.request.params.get('projectSlug')).toBe('p');
    expect(request.request.params.get('search')).toBe('acme');
    expect(request.request.params.get('tier')).toBe('Gold');
    request.flush({ summary: null });
  });

  it('lets read errors propagate so the page can tell a 403 from the rest', () => {
    setup();
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    let status = 0;
    service.getPage({ ...FILTERS, pageSize: 10, offset: 0 }).subscribe({ error: (error: HttpErrorResponse) => (status = error.status) });
    http.expectOne((req) => req.url === BASE).flush({}, { status: 403, statusText: 'Forbidden' });
    expect(status).toBe(403);
  });

  it('saves the CSV under the server filename and tells the user the export started', async () => {
    setup();
    let saved: string | null = null;
    service.exportCsv(FILTERS, 'by-project').subscribe((name) => (saved = name));
    const request = http.expectOne((req) => req.url === `${BASE}/export`);
    expect(request.request.params.get('kind')).toBe('by-project');
    request.flush(new Blob(['a,b']), { headers: { 'Content-Disposition': 'attachment; filename="synthetic.csv"' } });
    expect(saved).toBe('synthetic.csv');
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:synthetic');
    expect(add).toHaveBeenCalledWith(expect.objectContaining({ severity: 'success', summary: 'Export started' }));
  });

  it('warns when the export was cut at the row cap', () => {
    setup();
    service.exportCsv(FILTERS, 'summary').subscribe();
    http
      .expectOne((req) => req.url === `${BASE}/export`)
      .flush(new Blob(['a']), { headers: { [FOUNDATION_PARTICIPATING_ORGS_EXPORT_TRUNCATED_HEADER]: 'true' } });
    expect(add).toHaveBeenCalledWith(expect.objectContaining({ severity: 'warn', summary: 'Export truncated' }));
  });

  it('says there is nothing to export on an empty body and saves nothing', () => {
    setup();
    let saved: string | null = 'unset';
    service.exportCsv(FILTERS, 'summary').subscribe((name) => (saved = name));
    http.expectOne((req) => req.url === `${BASE}/export`).flush(new Blob([]), { status: 200, statusText: 'OK' });
    expect(saved).toBeNull();
    expect(add).toHaveBeenCalledWith(expect.objectContaining({ severity: 'info', summary: 'Nothing to export' }));
  });

  it('toasts an error and returns null when the export fails', () => {
    setup();
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    let saved: string | null = 'unset';
    service.exportCsv(FILTERS, 'summary').subscribe((name) => (saved = name));
    http.expectOne((req) => req.url === `${BASE}/export`).flush(null, { status: 500, statusText: 'Server Error' });
    expect(saved).toBeNull();
    expect(add).toHaveBeenCalledWith(expect.objectContaining({ severity: 'error', summary: 'Export failed' }));
  });

  it('reads nothing off the browser', () => {
    setup('server');
    let saved: string | null = 'unset';
    service.exportCsv(FILTERS, 'summary').subscribe((name) => (saved = name));
    http.expectNone((req) => req.url === `${BASE}/export`);
    expect(saved).toBeNull();
  });
});
