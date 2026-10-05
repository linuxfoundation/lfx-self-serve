// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { MentorshipProgramDetail, MentorshipProgramsResponse } from '@lfx-one/shared/interfaces';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MentorshipAdminService } from './mentorship-admin.service';

describe('MentorshipAdminService', () => {
  let service: MentorshipAdminService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [MentorshipAdminService, provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(MentorshipAdminService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    http.verify();
    vi.restoreAllMocks();
  });

  it('reads the program list from the admin endpoint with the filters as query params', () => {
    let total = -1;
    service.getPrograms({ search: 'grid', status: 'open', offset: 10, limit: 5 }).subscribe((response) => (total = response.total));

    const req = http.expectOne((r) => r.url === '/api/mentorship/admin/programs');
    expect(req.request.params.get('search')).toBe('grid');
    expect(req.request.params.get('status')).toBe('open');
    expect(req.request.params.get('offset')).toBe('10');
    expect(req.request.params.get('limit')).toBe('5');
    req.flush({ data: [], total: 3 } satisfies MentorshipProgramsResponse);
    expect(total).toBe(3);
  });

  it('logs a program list failure by status only, never the search, and lets it reach the caller', () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    let status: number | undefined;
    service.getPrograms({ search: 'secret-name' }).subscribe({ error: (err: { status: number }) => (status = err.status) });

    http.expectOne((r) => r.url === '/api/mentorship/admin/programs').flush('down', { status: 503, statusText: 'Service Unavailable' });
    expect(status).toBe(503);
    expect(logged).toHaveBeenCalledWith('[MentorshipAdminService] getPrograms failed', { status: 503, statusText: 'Service Unavailable' });
    expect(JSON.stringify(logged.mock.calls)).not.toContain('secret-name');
  });

  it('loads a program detail from the admin endpoint, encoding the id', () => {
    let detail: MentorshipProgramDetail | null = null;
    service.getProgram('grid flow').subscribe((value) => (detail = value));

    http.expectOne('/api/mentorship/admin/programs/grid%20flow').flush({ program: { id: 'p1' } } as unknown as MentorshipProgramDetail);
    expect(detail).toEqual({ program: { id: 'p1' } });
  });

  it('maps a missing program to null without logging', () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    let detail: MentorshipProgramDetail | null | undefined;
    service.getProgram('nope').subscribe((value) => (detail = value));

    http.expectOne('/api/mentorship/admin/programs/nope').flush('missing', { status: 404, statusText: 'Not Found' });
    expect(detail).toBeNull();
    expect(logged).not.toHaveBeenCalled();
  });
});
