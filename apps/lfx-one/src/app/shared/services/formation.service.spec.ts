// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { FormationService } from './formation.service';

describe('FormationService', () => {
  let service: FormationService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    service = TestBed.inject(FormationService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    http.verify();
  });

  it('getProjectFormation GETs /api/projects/:slug/formation, URI-encoding the slug', () => {
    service.getProjectFormation('cascade/data alliance').subscribe();

    const req = http.expectOne('/api/projects/cascade%2Fdata%20alliance/formation');
    expect(req.request.method).toBe('GET');
    req.flush({});
  });

  it('getFormationItem GETs /api/formation-items/:uid', () => {
    service.getFormationItem('formation-item:1').subscribe();

    const req = http.expectOne('/api/formation-items/formation-item%3A1');
    expect(req.request.method).toBe('GET');
    req.flush({});
  });

  it('completeFormationItem PATCHes /complete with optional notes', () => {
    service.completeFormationItem('formation-item:1', 'done early').subscribe();

    const req = http.expectOne('/api/formation-items/formation-item%3A1/complete');
    expect(req.request.method).toBe('PATCH');
    expect(req.request.body).toEqual({ notes: 'done early' });
    req.flush({});
  });

  it('skipFormationItem PATCHes /skip with the reason', () => {
    service.skipFormationItem('formation-item:1', 'blocked upstream').subscribe();

    const req = http.expectOne('/api/formation-items/formation-item%3A1/skip');
    expect(req.request.method).toBe('PATCH');
    expect(req.request.body).toEqual({ reason: 'blocked upstream' });
    req.flush({});
  });

  it('requestFormationItem PATCHes /request with an empty body', () => {
    service.requestFormationItem('formation-item:1').subscribe();

    const req = http.expectOne('/api/formation-items/formation-item%3A1/request');
    expect(req.request.method).toBe('PATCH');
    expect(req.request.body).toEqual({});
    req.flush({});
  });

  it('updateFormationItem PATCHes the bare item uid with the given patch', () => {
    service.updateFormationItem('formation-item:1', { notes: 'x', due_date: null }).subscribe();

    const req = http.expectOne('/api/formation-items/formation-item%3A1');
    expect(req.request.method).toBe('PATCH');
    expect(req.request.body).toEqual({ notes: 'x', due_date: null });
    req.flush({});
  });

  it('getFormationsQueue GETs /api/formations with sub_stage/search only when provided', () => {
    service.getFormationsQueue().subscribe();
    const bare = http.expectOne((r) => r.url === '/api/formations');
    expect(bare.request.params.keys()).toHaveLength(0);
    bare.flush({});

    service.getFormationsQueue('proposed', 'alliance').subscribe();
    const filtered = http.expectOne((r) => r.url === '/api/formations');
    expect(filtered.request.params.get('sub_stage')).toBe('proposed');
    expect(filtered.request.params.get('search')).toBe('alliance');
    filtered.flush({});
  });

  it('acceptFormation POSTs /api/formations/:uid/accept with an empty body', () => {
    service.acceptFormation('formation:1').subscribe();

    const req = http.expectOne('/api/formations/formation%3A1/accept');
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({});
    req.flush({});
  });

  it('declineFormation POSTs /api/formations/:uid/decline with the reason', () => {
    service.declineFormation('formation:1', 'opted out').subscribe();

    const req = http.expectOne('/api/formations/formation%3A1/decline');
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ reason: 'opted out' });
    req.flush({});
  });
});
