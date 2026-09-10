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

  it('getFormationItem GETs /api/formations/:projectUid/items/:itemKey, URI-encoding both', () => {
    service.getFormationItem('project/1', 'item key').subscribe();

    const req = http.expectOne('/api/formations/project%2F1/items/item%20key');
    expect(req.request.method).toBe('GET');
    req.flush({});
  });

  it('completeFormationItem PATCHes .../complete with optional notes', () => {
    service.completeFormationItem('project-1', 'item-1', 'done early').subscribe();

    const req = http.expectOne('/api/formations/project-1/items/item-1/complete');
    expect(req.request.method).toBe('PATCH');
    expect(req.request.body).toEqual({ notes: 'done early' });
    req.flush({});
  });

  it('skipFormationItem PATCHes .../skip with the reason', () => {
    service.skipFormationItem('project-1', 'item-1', 'blocked upstream').subscribe();

    const req = http.expectOne('/api/formations/project-1/items/item-1/skip');
    expect(req.request.method).toBe('PATCH');
    expect(req.request.body).toEqual({ reason: 'blocked upstream' });
    req.flush({});
  });

  it('requestFormationItem PATCHes .../request with an empty body', () => {
    service.requestFormationItem('project-1', 'item-1').subscribe();

    const req = http.expectOne('/api/formations/project-1/items/item-1/request');
    expect(req.request.method).toBe('PATCH');
    expect(req.request.body).toEqual({});
    req.flush({});
  });

  it('updateFormationItemStatus PATCHes .../status with the status and optional note', () => {
    service.updateFormationItemStatus('project-1', 'item-1', 'blocked', 'waiting on legal').subscribe();

    const req = http.expectOne('/api/formations/project-1/items/item-1/status');
    expect(req.request.method).toBe('PATCH');
    expect(req.request.body).toEqual({ status: 'blocked', note: 'waiting on legal' });
    req.flush({});
  });

  it('updateFormationItem PATCHes the bare item address with the given patch', () => {
    service.updateFormationItem('project-1', 'item-1', { notes: 'x', due_date: null }).subscribe();

    const req = http.expectOne('/api/formations/project-1/items/item-1');
    expect(req.request.method).toBe('PATCH');
    expect(req.request.body).toEqual({ notes: 'x', due_date: null });
    req.flush({});
  });

  it('acceptFormationItem POSTs .../accept with an optional note', () => {
    service.acceptFormationItem('project-1', 'item-1', 'looks good').subscribe();

    const req = http.expectOne('/api/formations/project-1/items/item-1/accept');
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ note: 'looks good' });
    req.flush({});
  });

  it('rejectFormationItem POSTs .../reject with the required note', () => {
    service.rejectFormationItem('project-1', 'item-1', 'missing evidence').subscribe();

    const req = http.expectOne('/api/formations/project-1/items/item-1/reject');
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ note: 'missing evidence' });
    req.flush({});
  });

  it('reopenFormationItem POSTs .../reopen with an optional note', () => {
    service.reopenFormationItem('project-1', 'item-1').subscribe();

    const req = http.expectOne('/api/formations/project-1/items/item-1/reopen');
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ note: undefined });
    req.flush({});
  });

  it('getFormationsQueue GETs /api/formations with sub_stage/search only when provided', () => {
    service.getFormationsQueue().subscribe();
    const bare = http.expectOne((r) => r.url === '/api/formations');
    expect(bare.request.params.keys()).toHaveLength(0);
    bare.flush({});

    service.getFormationsQueue('engaged', 'alliance').subscribe();
    const filtered = http.expectOne((r) => r.url === '/api/formations');
    expect(filtered.request.params.get('sub_stage')).toBe('engaged');
    expect(filtered.request.params.get('search')).toBe('alliance');
    filtered.flush({});
  });

  it('getMyFormationWork shares one GET across concurrent subscribers', () => {
    service.getMyFormationWork().subscribe();
    service.getMyFormationWork().subscribe();

    const req = http.expectOne('/api/user/formation-work');
    expect(req.request.method).toBe('GET');
    req.flush({ formations: [], items: [], data_source: 'fixture' });
  });

  it('getMyFormationWork replays the cached response to a later subscriber without a second GET', () => {
    service.getMyFormationWork().subscribe();
    http.expectOne('/api/user/formation-work').flush({ formations: [], items: [], data_source: 'fixture' });

    let replayed: unknown;
    service.getMyFormationWork().subscribe((response) => (replayed = response));
    http.expectNone('/api/user/formation-work');
    expect(replayed).toEqual({ formations: [], items: [], data_source: 'fixture' });
  });

  it('invalidateMyFormationWork() pushes a fresh response to an already-live subscriber', () => {
    const received: unknown[] = [];
    service.getMyFormationWork().subscribe((response) => received.push(response));
    http.expectOne('/api/user/formation-work').flush({ formations: [], items: [], data_source: 'fixture' });

    service.invalidateMyFormationWork();
    http.expectOne('/api/user/formation-work').flush({ formations: [{ formation_uid: 'f-1' }], items: [], data_source: 'fixture' });

    expect(received).toEqual([
      { formations: [], items: [], data_source: 'fixture' },
      { formations: [{ formation_uid: 'f-1' }], items: [], data_source: 'fixture' },
    ]);
  });

  it('getMyFormationWork() falls back to an empty response and stays subscribable after a failed fetch', () => {
    const received: unknown[] = [];
    service.getMyFormationWork().subscribe((response) => received.push(response));
    http.expectOne('/api/user/formation-work').error(new ProgressEvent('error'));

    service.invalidateMyFormationWork();
    http.expectOne('/api/user/formation-work').flush({ formations: [{ formation_uid: 'f-1' }], items: [], data_source: 'fixture' });

    expect(received).toEqual([
      { formations: [], items: [], data_source: 'fixture' },
      { formations: [{ formation_uid: 'f-1' }], items: [], data_source: 'fixture' },
    ]);
  });

  it('a mutation method invalidates my-formation-work on success', () => {
    service.getMyFormationWork().subscribe();
    http.expectOne('/api/user/formation-work').flush({ formations: [], items: [], data_source: 'fixture' });

    service.completeFormationItem('project-1', 'item-1').subscribe();
    http.expectOne('/api/formations/project-1/items/item-1/complete').flush({});

    http.expectOne('/api/user/formation-work').flush({ formations: [], items: [], data_source: 'fixture' });
  });

  it('a mutation method does not invalidate my-formation-work when the request errors', () => {
    service.getMyFormationWork().subscribe();
    http.expectOne('/api/user/formation-work').flush({ formations: [], items: [], data_source: 'fixture' });

    service.completeFormationItem('project-1', 'item-1').subscribe({ error: () => undefined });
    http.expectOne('/api/formations/project-1/items/item-1/complete').error(new ProgressEvent('error'));

    http.expectNone('/api/user/formation-work');
  });
});
