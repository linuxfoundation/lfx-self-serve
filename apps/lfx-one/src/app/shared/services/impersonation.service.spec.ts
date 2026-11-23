// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { ImpersonationSuggestion } from '@lfx-one/shared/interfaces';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ImpersonationService } from './impersonation.service';

describe('ImpersonationService transition', () => {
  let service: ImpersonationService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    service = TestBed.inject(ImpersonationService);
    http = TestBed.inject(HttpTestingController);
  });

  it('is idle until a change starts', () => {
    expect(service.transition()).toBeNull();
  });

  it('marks a start as starting and a switch as switching', () => {
    service.startImpersonation('jdoe').subscribe();
    expect(service.transition()).toBe('starting');
    http.expectOne('/api/impersonate').flush({});

    service.startImpersonation('jdoe', true).subscribe();
    expect(service.transition()).toBe('switching');
    http.expectOne('/api/impersonate').flush({});
  });

  it('keeps the transition after success so the overlay covers the page reload', () => {
    service.stopImpersonation().subscribe();
    expect(service.transition()).toBe('stopping');

    http.expectOne('/api/impersonate/stop').flush({ impersonating: false });

    expect(service.transition()).toBe('stopping');
  });

  it('clears the transition when the request fails', () => {
    service.startImpersonation('jdoe', true).subscribe({ error: () => undefined });

    http.expectOne('/api/impersonate').flush({}, { status: 404, statusText: 'Not Found' });

    expect(service.transition()).toBeNull();
  });
});

describe('ImpersonationService.searchUsers', () => {
  let service: ImpersonationService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    service = TestBed.inject(ImpersonationService);
    http = TestBed.inject(HttpTestingController);
  });

  const collect = (query: string): Promise<ImpersonationSuggestion[]> => new Promise((resolve) => service.searchUsers(query).subscribe(resolve));

  it('posts the typed text to the impersonation search route and returns its results', async () => {
    const result = collect('jane');

    const req = http.expectOne((r) => r.url === '/api/impersonate/users/search');
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ q: 'jane' });
    const person: ImpersonationSuggestion = { targetUser: 'jdoe', username: 'jdoe', email: 'jane.doe@example.test', name: 'Jane Doe' };
    req.flush({ results: [person] });

    await expect(result).resolves.toEqual([person]);
  });

  it('sends the text in the body and keeps it out of the URL', () => {
    collect('jane+tag@example.test');

    const req = http.expectOne((r) => r.url === '/api/impersonate/users/search');
    expect(req.request.body).toEqual({ q: 'jane+tag@example.test' });
    expect(req.request.urlWithParams).toBe('/api/impersonate/users/search');
    req.flush({ results: [] });
  });

  it('returns no results for an empty response body', async () => {
    const result = collect('jane');

    http.expectOne((r) => r.url === '/api/impersonate/users/search').flush({});

    await expect(result).resolves.toEqual([]);
  });

  it('degrades to no results on failure and logs only the status and code, never the searched text', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const result = collect('jane.doe@example.test');

    http
      .expectOne((r) => r.url === '/api/impersonate/users/search')
      .flush({ code: 'IMPERSONATION_SEARCH_UNAVAILABLE' }, { status: 503, statusText: 'Service Unavailable' });

    await expect(result).resolves.toEqual([]);
    expect(consoleError).toHaveBeenCalledWith('Error searching users to impersonate:', { status: 503, code: 'IMPERSONATION_SEARCH_UNAVAILABLE' });
    expect(JSON.stringify(consoleError.mock.calls)).not.toContain('jane.doe');
    consoleError.mockRestore();
  });
});
