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

  it('getFormationPeople GETs /api/projects/:slug/formation/people, URI-encoding the slug', () => {
    service.getFormationPeople('cascade/data alliance').subscribe();

    const req = http.expectOne('/api/projects/cascade%2Fdata%20alliance/formation/people');
    expect(req.request.method).toBe('GET');
    req.flush({ state: 'loaded', people: [] });
  });

  it('getFormationPeople degrades an HTTP failure to the unavailable shape instead of erroring (#2724)', async () => {
    const result = new Promise((resolve) => service.getFormationPeople('cascade-data-alliance').subscribe(resolve));

    http.expectOne('/api/projects/cascade-data-alliance/formation/people').flush('nope', { status: 500, statusText: 'Server Error' });

    await expect(result).resolves.toEqual({ state: 'unavailable', people: [] });
  });

  // #2772: the item drawer replays this read on every open, so the card and the drawer share one answer per slug.
  it('getFormationPeople memoises a loaded answer per slug — a later reader replays it with no second request', async () => {
    const first = new Promise((resolve) => service.getFormationPeople('cascade-data-alliance').subscribe(resolve));
    http.expectOne('/api/projects/cascade-data-alliance/formation/people').flush({ state: 'loaded', people: [] });
    await first;

    const second = new Promise((resolve) => service.getFormationPeople('cascade-data-alliance').subscribe(resolve));

    http.expectNone('/api/projects/cascade-data-alliance/formation/people');
    await expect(second).resolves.toEqual({ state: 'loaded', people: [] });
  });

  it('invalidateFormationPeople drops the memo so the next reader reads afresh', async () => {
    const first = new Promise((resolve) => service.getFormationPeople('cascade-data-alliance').subscribe(resolve));
    http.expectOne('/api/projects/cascade-data-alliance/formation/people').flush({ state: 'loaded', people: [] });
    await first;

    service.invalidateFormationPeople('cascade-data-alliance');
    service.getFormationPeople('cascade-data-alliance').subscribe();

    http.expectOne('/api/projects/cascade-data-alliance/formation/people').flush({ state: 'loaded', people: [] });
  });

  it('getFormationPeople never keeps an unavailable answer, so a transient failure is retried', async () => {
    const first = new Promise((resolve) => service.getFormationPeople('cascade-data-alliance').subscribe(resolve));
    http.expectOne('/api/projects/cascade-data-alliance/formation/people').flush('nope', { status: 500, statusText: 'Server Error' });
    await first;

    service.getFormationPeople('cascade-data-alliance').subscribe();

    http.expectOne('/api/projects/cascade-data-alliance/formation/people').flush({ state: 'loaded', people: [] });
  });

  it('getFormationItem GETs /api/formations/:projectUid/items/:itemKey, URI-encoding both', () => {
    service.getFormationItem('project/1', 'item key').subscribe();

    const req = http.expectOne('/api/formations/project%2F1/items/item%20key');
    expect(req.request.method).toBe('GET');
    req.flush({});
  });

  it('updateFormationItem PATCHes the bare item address with If-Match and the note/evidence_link patch', () => {
    service.updateFormationItem('project-1', 'item-1', '5', { note: 'x' }).subscribe();

    const req = http.expectOne('/api/formations/project-1/items/item-1');
    expect(req.request.method).toBe('PATCH');
    expect(req.request.headers.get('If-Match')).toBe('5');
    expect(req.request.body).toEqual({ note: 'x' });
    req.flush({ item: {}, etag: '6' });
  });

  it('updateFormationItemAssignment POSTs .../assignment with If-Match and the assignee/due_date patch', () => {
    service.updateFormationItemAssignment('project-1', 'item-1', '5', { assignee: 'sam.chen', due_date: '' }).subscribe();

    const req = http.expectOne('/api/formations/project-1/items/item-1/assignment');
    expect(req.request.method).toBe('POST');
    expect(req.request.headers.get('If-Match')).toBe('5');
    expect(req.request.body).toEqual({ assignee: 'sam.chen', due_date: '' });
    req.flush({ item: {}, etag: '6' });
  });

  it('updateFormationItemStatus POSTs .../status with If-Match and the status/reason patch', () => {
    service.updateFormationItemStatus('project-1', 'item-1', '5', { status: 'blocked', reason: 'waiting on legal' }).subscribe();

    const req = http.expectOne('/api/formations/project-1/items/item-1/status');
    expect(req.request.method).toBe('POST');
    expect(req.request.headers.get('If-Match')).toBe('5');
    expect(req.request.body).toEqual({ status: 'blocked', reason: 'waiting on legal' });
    req.flush({ item: {}, etag: '6' });
  });

  it('returns the item and etag from the write response body', () => {
    let result: { item: unknown; etag: string | null } | undefined;
    service.updateFormationItemStatus('project-1', 'item-1', '5', { status: 'done' }).subscribe((r) => (result = r));

    http.expectOne('/api/formations/project-1/items/item-1/status').flush({ item: { uid: 'item-1', status: 'done' }, etag: '6' });

    expect(result).toEqual({ item: { uid: 'item-1', status: 'done' }, etag: '6' });
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

  // GH-2367: scope the queue to the selected foundation.
  it('getFormationsQueue sets foundation_uid only when a foundation uid is passed', () => {
    service.getFormationsQueue().subscribe();
    const bare = http.expectOne((r) => r.url === '/api/formations');
    expect(bare.request.params.has('foundation_uid')).toBe(false);
    bare.flush({});

    service.getFormationsQueue(undefined, undefined, 'aaif-uid-1').subscribe();
    const scoped = http.expectOne((r) => r.url === '/api/formations');
    expect(scoped.request.params.get('foundation_uid')).toBe('aaif-uid-1');
    scoped.flush({});
  });

  it('getMyFormationWork shares one GET across concurrent subscribers', () => {
    service.getMyFormationWork().subscribe();
    service.getMyFormationWork().subscribe();

    const req = http.expectOne('/api/user/formation-work');
    expect(req.request.method).toBe('GET');
    req.flush({ formations: [], items: [], state: 'complete' });
  });

  it('getMyFormationWork replays the cached response to a later subscriber without a second GET', () => {
    service.getMyFormationWork().subscribe();
    http.expectOne('/api/user/formation-work').flush({ formations: [], items: [], state: 'complete' });

    let replayed: unknown;
    service.getMyFormationWork().subscribe((response) => (replayed = response));
    http.expectNone('/api/user/formation-work');
    expect(replayed).toEqual({ formations: [], items: [], state: 'complete' });
  });

  it('invalidateMyFormationWork() pushes a fresh response to an already-live subscriber', () => {
    const received: unknown[] = [];
    service.getMyFormationWork().subscribe((response) => received.push(response));
    http.expectOne('/api/user/formation-work').flush({ formations: [], items: [], state: 'complete' });

    service.invalidateMyFormationWork();
    http.expectOne('/api/user/formation-work').flush({ formations: [{ formation_uid: 'f-1' }], items: [], state: 'complete' });

    expect(received).toEqual([
      { formations: [], items: [], state: 'complete' },
      { formations: [{ formation_uid: 'f-1' }], items: [], state: 'complete' },
    ]);
  });

  it('getMyFormationWork() falls back to an empty response with state unavailable and stays subscribable after a failed fetch', () => {
    const received: unknown[] = [];
    service.getMyFormationWork().subscribe((response) => received.push(response));
    http.expectOne('/api/user/formation-work').error(new ProgressEvent('error'));

    service.invalidateMyFormationWork();
    http.expectOne('/api/user/formation-work').flush({ formations: [{ formation_uid: 'f-1' }], items: [], state: 'complete' });

    expect(received).toEqual([
      { formations: [], items: [], state: 'unavailable' },
      { formations: [{ formation_uid: 'f-1' }], items: [], state: 'complete' },
    ]);
  });

  it('a write method invalidates my-formation-work on success', () => {
    service.getMyFormationWork().subscribe();
    http.expectOne('/api/user/formation-work').flush({ formations: [], items: [], state: 'complete' });

    service.updateFormationItemStatus('project-1', 'item-1', '1', { status: 'done' }).subscribe();
    http.expectOne('/api/formations/project-1/items/item-1/status').flush({ item: {}, etag: '2' });

    http.expectOne('/api/user/formation-work').flush({ formations: [], items: [], state: 'complete' });
  });

  it('a write method does not invalidate my-formation-work when the request errors', () => {
    service.getMyFormationWork().subscribe();
    http.expectOne('/api/user/formation-work').flush({ formations: [], items: [], state: 'complete' });

    service.updateFormationItemStatus('project-1', 'item-1', '1', { status: 'done' }).subscribe({ error: () => undefined });
    http.expectOne('/api/formations/project-1/items/item-1/status').error(new ProgressEvent('error'));

    http.expectNone('/api/user/formation-work');
  });
});
