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
 * lfx-self-serve#4126 — the client half of the roll-up set. It must re-fetch with the grants, and
 * keep any failure, a 404 included, from reading as a family that shrank.
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
    expect(service.incomplete()).toBe(false);
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

  // Between a grants reload and the families that answer it, the previous families describe the
  // grants that were replaced: nothing may admit or demote on them.
  it('is unsettled from a grants reload until the families answer it', () => {
    grantsLoad(1);
    http.expectOne(ORG_ROLL_UP_SET_PATH).flush(response());
    expect(service.unsettled()).toBe(false);

    loadedAtMs.set(2);
    expect(service.unsettled()).toBe(true);
    TestBed.tick();
    http.expectOne(ORG_ROLL_UP_SET_PATH).flush(response());

    expect(service.unsettled()).toBe(false);
  });

  it('stays unsettled on a partial answer until a complete one lands', () => {
    grantsLoad(1);
    http.expectOne(ORG_ROLL_UP_SET_PATH).flush(response({ degraded: true, lookupOutcome: 'partial' }));
    expect(service.unsettled()).toBe(true);

    grantsLoad(2);
    http.expectOne(ORG_ROLL_UP_SET_PATH).flush(response());
    expect(service.unsettled()).toBe(false);
  });

  it('re-fetches when the grants reload', () => {
    grantsLoad(1);
    http.expectOne(ORG_ROLL_UP_SET_PATH).flush(response());
    grantsLoad(2);
    http.expectOne(ORG_ROLL_UP_SET_PATH).flush(response({ families: [] }));

    expect(service.families()).toEqual([]);
  });

  it('keeps a lower-bound answer unsettled', () => {
    grantsLoad(1);
    http.expectOne(ORG_ROLL_UP_SET_PATH).flush(response({ degraded: true, lookupOutcome: 'partial' }));

    expect(service.hasServerFamilies()).toBe(true);
    expect(service.unsettled()).toBe(true);
    expect(service.incomplete()).toBe(true);
  });

  it('derives the outcome from `degraded` when the server omits it', () => {
    grantsLoad(1);
    const withoutOutcome: Partial<OrgRollUpSetResponse> = response({ degraded: true });
    delete withoutOutcome.lookupOutcome;
    http.expectOne(ORG_ROLL_UP_SET_PATH).flush(withoutOutcome);

    expect(service.lookupOutcome()).toBe('partial');
  });

  // The app and the BFF ship together, so a 404 is a failure like any other — never a settled
  // "no families" that would let a restored roll-up demote and overwrite its cookie.
  it('reports a 404 as unknown and unsettled', () => {
    grantsLoad(1);
    http.expectOne(ORG_ROLL_UP_SET_PATH).flush('not found', { status: 404, statusText: 'Not Found' });

    expect(service.source()).toBe('server');
    expect(service.lookupOutcome()).toBe('failed');
    expect(service.hasServerFamilies()).toBe(false);
    expect(service.unsettled()).toBe(true);
    expect(service.incomplete()).toBe(true);
  });

  // A 200 with no usable body is no more an answer than a failure: "no families" would let a restored roll-up demote.
  it('reports an empty or malformed body as unknown rather than empty', () => {
    grantsLoad(1);
    http.expectOne(ORG_ROLL_UP_SET_PATH).flush(null);

    expect(service.lookupOutcome()).toBe('failed');
    expect(service.hasServerFamilies()).toBe(false);
    expect(service.unsettled()).toBe(true);

    grantsLoad(2);
    http.expectOne(ORG_ROLL_UP_SET_PATH).flush({ degraded: false });

    expect(service.lookupOutcome()).toBe('failed');
    expect(service.unsettled()).toBe(true);
  });

  // An outage must never read as a family that shrank: unusable, and unsettled so nothing demotes.
  it('reports any failure as unknown rather than empty', () => {
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
