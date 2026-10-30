// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';

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
