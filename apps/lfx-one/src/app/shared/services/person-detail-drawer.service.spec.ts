// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { AccountContextService } from '@services/account-context.service';
import { FeatureFlagService } from '@services/feature-flag.service';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { PersonDetailDrawerService } from './person-detail-drawer.service';

const ORG = 'org-uid-1';
const EMAILS = `/api/orgs/${ORG}/lens/people/live-access-ada/company-emails`;

describe('PersonDetailDrawerService — company-email request', () => {
  let service: PersonDetailDrawerService;
  let http: HttpTestingController;

  async function flushEffects(): Promise<void> {
    TestBed.tick();
    await Promise.resolve();
  }

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: AccountContextService, useValue: { selectedAccount: signal({ uid: ORG, accountName: 'Acme' }) } },
        { provide: FeatureFlagService, useValue: { getBooleanFlag: () => signal(true) } },
      ],
    });
    service = TestBed.inject(PersonDetailDrawerService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    http.match(() => true).forEach((request) => request.flush(null));
  });

  // A live-only person resolves against the directory the page has warmed, so the request names it.
  it('names the directory the opener showed the person in', async () => {
    service.open({ personKey: 'live-access-ada', name: 'Ada', directoryView: { range: '90d', projectScope: 'lf' } });
    await flushEffects();

    const request = http.expectOne((req) => req.url === EMAILS);
    expect(request.request.urlWithParams).toBe(`${EMAILS}?range=90d&projectScope=lf`);
  });

  it('sends no directory params for an opener without one', async () => {
    service.open({ personKey: 'live-access-ada', name: 'Ada' });
    await flushEffects();

    expect(http.expectOne((req) => req.url === EMAILS).request.urlWithParams).toBe(EMAILS);
  });
});

// lfx-self-serve#4685
describe('PersonDetailDrawerService — detail request', () => {
  let service: PersonDetailDrawerService;
  let http: HttpTestingController;
  const DETAIL = `/api/orgs/${ORG}/lens/people/person-one/detail`;

  async function flushEffects(): Promise<void> {
    TestBed.tick();
    await Promise.resolve();
  }

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: AccountContextService, useValue: { selectedAccount: signal({ uid: ORG, accountName: 'Acme' }) } },
        { provide: FeatureFlagService, useValue: { getBooleanFlag: () => signal(true) } },
      ],
    });
    service = TestBed.inject(PersonDetailDrawerService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    http.match(() => true).forEach((request) => request.flush(null));
  });

  it("sends the opener's Team members pick with its code filters", async () => {
    service.open({
      personKey: 'person-one',
      name: 'Ada',
      range: '90d',
      codeFilters: { projectScope: 'lf', commitScope: 'all', metric: 'code' },
      teamMembers: 'include',
    });
    await flushEffects();

    const request = http.expectOne((req) => req.url === DETAIL);
    expect(request.request.params.get('teamMembers')).toBe('include');
    expect(request.request.params.get('projectScope')).toBe('lf');
  });

  it('sends no Team members pick without code filters', async () => {
    service.open({ personKey: 'person-one', name: 'Ada', teamMembers: 'exclude' });
    await flushEffects();

    expect(http.expectOne((req) => req.url === DETAIL).request.params.has('teamMembers')).toBe(false);
  });

  it("sends the opener's Organization scope pick with its code filters", async () => {
    service.open({
      personKey: 'person-one',
      name: 'Ada',
      range: '90d',
      codeFilters: { projectScope: 'all', commitScope: 'all', metric: 'code' },
      orgScope: 'all',
    });
    await flushEffects();

    expect(http.expectOne((req) => req.url === DETAIL).request.params.get('orgScope')).toBe('all');
  });

  it('sends no Organization scope pick without code filters', async () => {
    service.open({ personKey: 'person-one', name: 'Ada', orgScope: 'all' });
    await flushEffects();

    expect(http.expectOne((req) => req.url === DETAIL).request.params.has('orgScope')).toBe(false);
  });
});
