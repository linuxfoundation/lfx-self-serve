// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { signal, WritableSignal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ORG_ROLL_UP_SET_PATH } from '@lfx-one/shared/constants';
import { OrgRollUpSetResponse } from '@lfx-one/shared/interfaces';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { OrgRoleGrantsService } from './org-role-grants.service';
import { OrgRollUpFamiliesService } from './org-roll-up-families.service';

const UID_A = '0014100000MgaAAAAA';
const UID_B = '0014100000MgbBBBBB';
const UID_C = '0014100000MgcCCCCC';

const org = (uid: string, name: string) => ({ uid, accountId: uid, name, logoUrl: null });

const response = (overrides: Partial<OrgRollUpSetResponse> = {}): OrgRollUpSetResponse => ({
  families: [
    { rootUid: UID_A, rootName: 'Alpha', rootLogoUrl: null, orgs: [org(UID_A, 'Alpha'), org(UID_B, 'Bravo')] },
    { rootUid: UID_C, rootName: 'Charlie', rootLogoUrl: null, orgs: [org(UID_C, 'Charlie')] },
  ],
  degraded: false,
  lookupOutcome: 'ok',
  ...overrides,
});

/**
 * lfx-self-serve#4126 — the client half of the roll-up set. It must re-fetch with the grants, keep
 * an outage from reading as a family that shrank, and report a missing endpoint so the switcher can
 * fall back to its own grouping.
 */
describe('OrgRollUpFamiliesService', () => {
  let service: OrgRollUpFamiliesService;
  let http: HttpTestingController;
  let loadedAtMs: WritableSignal<number | null>;

  const grantsLoad = (at: number): void => {
    loadedAtMs.set(at);
    TestBed.tick();
  };

  beforeEach(() => {
    loadedAtMs = signal<number | null>(null);
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting(), { provide: OrgRoleGrantsService, useValue: { loadedAtMs } }],
    });
    service = TestBed.inject(OrgRollUpFamiliesService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('waits for the grants before asking, and is unsettled until it is answered', () => {
    TestBed.tick();
    http.expectNone(ORG_ROLL_UP_SET_PATH);
    expect(service.source()).toBe('pending');
    expect(service.unsettled()).toBe(true);
  });

  it('maps the families and indexes their organizations', () => {
    grantsLoad(1);
    http.expectOne(ORG_ROLL_UP_SET_PATH).flush(response());

    expect(service.source()).toBe('server');
    expect(service.hasServerFamilies()).toBe(true);
    expect(service.unsettled()).toBe(false);
    expect(service.families()).toEqual([
      { rootUid: UID_A, name: 'Alpha', orgUids: [UID_A, UID_B] },
      { rootUid: UID_C, name: 'Charlie', orgUids: [UID_C] },
    ]);
    expect(service.orgsByUid().get(UID_B)?.name).toBe('Bravo');
  });

  it('places a repeated organization in the first family only', () => {
    grantsLoad(1);
    http.expectOne(ORG_ROLL_UP_SET_PATH).flush(
      response({
        families: [
          { rootUid: UID_A, rootName: 'Alpha', rootLogoUrl: null, orgs: [org(UID_A, 'Alpha'), org(UID_B, 'Bravo')] },
          { rootUid: UID_C, rootName: 'Charlie', rootLogoUrl: null, orgs: [org(UID_B, 'Bravo'), org(UID_C, 'Charlie')] },
        ],
      })
    );

    expect(service.families()[1].orgUids).toEqual([UID_C]);
  });

  it('re-fetches when the grants reload', () => {
    grantsLoad(1);
    http.expectOne(ORG_ROLL_UP_SET_PATH).flush(response());
    grantsLoad(2);
    http.expectOne(ORG_ROLL_UP_SET_PATH).flush(response({ families: [] }));

    expect(service.families()).toEqual([]);
  });

  it('asks the BFF to skip its cache on an explicit refresh', () => {
    service.refresh(true);
    http.expectOne((request) => request.url === ORG_ROLL_UP_SET_PATH && request.params.get('refresh') === '1').flush(response());
    expect(service.source()).toBe('server');
  });

  it('keeps a lower-bound answer unsettled', () => {
    grantsLoad(1);
    http.expectOne(ORG_ROLL_UP_SET_PATH).flush(response({ degraded: true, lookupOutcome: 'partial' }));

    expect(service.hasServerFamilies()).toBe(true);
    expect(service.unsettled()).toBe(true);
  });

  it('derives the outcome from `degraded` when the server omits it', () => {
    grantsLoad(1);
    const withoutOutcome: Partial<OrgRollUpSetResponse> = response({ degraded: true });
    delete withoutOutcome.lookupOutcome;
    http.expectOne(ORG_ROLL_UP_SET_PATH).flush(withoutOutcome);

    expect(service.lookupOutcome()).toBe('partial');
  });

  // Until #4126 ships the BFF answers 404. That is a settled "no server grouping", not an outage.
  it('reports a missing endpoint as unavailable and settled', () => {
    grantsLoad(1);
    http.expectOne(ORG_ROLL_UP_SET_PATH).flush('not found', { status: 404, statusText: 'Not Found' });

    expect(service.source()).toBe('unavailable');
    expect(service.hasServerFamilies()).toBe(false);
    expect(service.unsettled()).toBe(false);
  });

  // An outage must never read as a family that shrank: unusable, and unsettled so nothing demotes.
  it('reports any other failure as unknown rather than empty', () => {
    grantsLoad(1);
    http.expectOne(ORG_ROLL_UP_SET_PATH).flush(response());
    grantsLoad(2);
    http.expectOne(ORG_ROLL_UP_SET_PATH).flush('boom', { status: 503, statusText: 'Service Unavailable' });

    expect(service.lookupOutcome()).toBe('failed');
    expect(service.hasServerFamilies()).toBe(false);
    expect(service.unsettled()).toBe(true);
    expect(service.families()).toEqual([]);
  });
});
