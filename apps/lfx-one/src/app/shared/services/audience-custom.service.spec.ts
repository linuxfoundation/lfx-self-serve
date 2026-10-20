// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpErrorResponse, provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { AudienceCustomCriteria } from '@lfx-one/shared/interfaces';

import { AudienceCustomService } from './audience-custom.service';

const criteria: AudienceCustomCriteria = {
  cities: ['Seoul'],
  countries: [],
  contactLocation: true,
  eventRegistered: false,
  educationEnrolled: false,
  registeredFor: [],
  gateEventHistory: false,
  gateListId: '26716',
  propertyFilters: [],
  ambassadors: false,
  educationTopics: [],
  pageViewUrls: [],
};

/** Each call is a POST to its own route, scoped to the project — create is not idempotent, so a wrong path is not a harmless typo. */
describe('AudienceCustomService', () => {
  let service: AudienceCustomService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    service = TestBed.inject(AudienceCustomService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('interprets on its own route, scoped to the project', () => {
    service.interpret('tlf', { request: 'Seoul contacts' }).subscribe();

    const req = http.expectOne((r) => r.url === '/api/campaigns/audience-builder/custom/interpret');
    expect(req.request.method).toBe('POST');
    expect(req.request.params.get('project')).toBe('tlf');
    expect(req.request.body).toEqual({ request: 'Seoul contacts' });
    req.flush({ criteria, questions: [], notes: [], similar: [] });
  });

  it('previews on its own route, scoped to the project', () => {
    service.preview('tlf', { criteria }).subscribe();

    const req = http.expectOne((r) => r.url === '/api/campaigns/audience-builder/custom/preview');
    expect(req.request.method).toBe('POST');
    expect(req.request.params.get('project')).toBe('tlf');
    req.flush({ name: 'n', criteria, branchCount: 1, educationTopicCandidates: [], warnings: [] });
  });

  it('creates on its own route, scoped to the project, and passes a 502 partial through', () => {
    let failure: HttpErrorResponse | undefined;
    service.create('tlf', { criteria, name: 'Seoul' }).subscribe({ error: (e: HttpErrorResponse) => (failure = e) });

    const req = http.expectOne((r) => r.url === '/api/campaigns/audience-builder/custom/create');
    expect(req.request.method).toBe('POST');
    expect(req.request.params.get('project')).toBe('tlf');
    expect(req.request.body).toEqual({ criteria, name: 'Seoul' });
    req.flush({ masterName: 'Seoul' }, { status: 502, statusText: 'Bad Gateway' });

    expect(failure?.status).toBe(502);
    expect(failure?.error).toEqual({ masterName: 'Seoul' });
  });

  // A builder destroyed before its create settled never sees the reply; the service keeps the
  // outcome so a remounted builder does not offer a second create.
  it.each([
    [503, { kind: 'unconfirmed', name: 'Seoul' }],
    [0, { kind: 'unconfirmed', name: 'Seoul' }],
    [400, null],
  ])('keeps a %s create outcome for the project until a builder takes it', (status, want) => {
    service.create('tlf', { criteria, name: 'Seoul' }).subscribe({ error: () => undefined });
    http.expectOne((r) => r.url === '/api/campaigns/audience-builder/custom/create').flush({ message: 'x' }, { status, statusText: 'x' });

    expect(service.takeCreateOutcome('tlf')).toEqual(want);
    expect(service.takeCreateOutcome('tlf'), 'taken once').toBeNull();
  });

  it('keeps a created list for the project, and tracks the create in flight until it settles', () => {
    service.create('tlf', { criteria, name: 'Seoul' }).subscribe();
    expect(service.inFlightCreate('tlf')).toBe('Seoul');
    http
      .expectOne((r) => r.url === '/api/campaigns/audience-builder/custom/create')
      .flush({ listId: '7', name: 'Seoul', hubspotUrl: 'https://app.hubspot.com/x/7' });

    expect(service.inFlightCreate('tlf')).toBeNull();
    expect(service.takeCreateOutcome('tlf')).toEqual({ kind: 'created', list: { listId: '7', name: 'Seoul', hubspotUrl: 'https://app.hubspot.com/x/7' } });
  });
});
