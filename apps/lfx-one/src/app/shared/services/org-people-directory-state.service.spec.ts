// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { EMPTY_ORG_ALL_EMPLOYEE_STATS } from '@lfx-one/shared/constants';
import type { OrgAllEmployeeRow, OrgAllEmployeesResponse } from '@lfx-one/shared/interfaces';
import { firstValueFrom } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SYNTHETIC_ORG_ACCOUNT_ID } from '../../../../e2e/fixtures/mock-data/synthetic-org.mock';
import { OrgPeopleDirectoryStateService } from './org-people-directory-state.service';

const urlFor = (range: string, projectScope = 'all', commitScope = 'all', metric = 'code', teamMembers = 'exclude'): string =>
  `/api/orgs/${SYNTHETIC_ORG_ACCOUNT_ID}/lens/people/all?live=true&range=${range}&projectScope=${projectScope}&commitScope=${commitScope}&metric=${metric}&teamMembers=${teamMembers}`;
const URL = urlFor('365d');
const ROSTER_URL = `/api/orgs/${SYNTHETIC_ORG_ACCOUNT_ID}/lens/people/all?live=true`;

function roster(name: string): OrgAllEmployeesResponse {
  const row: OrgAllEmployeeRow = {
    personKey: 'p-1',
    lfid: null,
    lfUsername: null,
    cdpMemberId: null,
    name,
    firstName: null,
    lastName: null,
    title: null,
    email: null,
    avatarUrl: null,
    sources: ['snowflake'],
    seatsCount: 1,
    boardSeatsCount: 0,
    committeeSeatsCount: 1,
    keyContactRoles: [],
    commitsCount: 0,
    codeActivitiesCount: 0,
    eventsCount: 0,
    coursesCount: 0,
    engagedFoundationIds: [],
  };
  return { accountId: SYNTHETIC_ORG_ACCOUNT_ID, rows: [row], stats: EMPTY_ORG_ALL_EMPLOYEE_STATS, foundations: [] };
}

describe('OrgPeopleDirectoryStateService', () => {
  let service: OrgPeopleDirectoryStateService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    service = TestBed.inject(OrgPeopleDirectoryStateService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    http.verify();
  });

  it('serves a resolved directory from cache without a second request', async () => {
    const first = firstValueFrom(service.getDirectory(SYNTHETIC_ORG_ACCOUNT_ID, '365d'));
    http.expectOne(URL).flush(roster('Ada Lovelace'));
    await first;

    await expect(firstValueFrom(service.getDirectory(SYNTHETIC_ORG_ACCOUNT_ID, '365d'))).resolves.toEqual(roster('Ada Lovelace'));
    http.expectNone(URL);
  });

  // A reassign invalidates while a pre-reassign request is still pending. That request must not put
  // the old roster back into the cache when it lands, or the next read would replay it for the TTL.
  it('does not let a request started before invalidate() repopulate the cache', async () => {
    const stale = firstValueFrom(service.getDirectory(SYNTHETIC_ORG_ACCOUNT_ID, '365d'));
    const staleRequest = http.expectOne(URL);

    service.invalidate(SYNTHETIC_ORG_ACCOUNT_ID);
    staleRequest.flush(roster('Before Reassign'));
    // Its own subscriber still gets the answer it asked for.
    await expect(stale).resolves.toEqual(roster('Before Reassign'));

    const fresh = firstValueFrom(service.getDirectory(SYNTHETIC_ORG_ACCOUNT_ID, '365d'));
    http.expectOne(URL).flush(roster('After Reassign'));
    await expect(fresh).resolves.toEqual(roster('After Reassign'));
  });

  it('does not let a superseded request drop its successor from the in-flight dedupe', async () => {
    const stale = firstValueFrom(service.getDirectory(SYNTHETIC_ORG_ACCOUNT_ID, '365d'));
    const staleRequest = http.expectOne(URL);
    service.invalidate(SYNTHETIC_ORG_ACCOUNT_ID);

    const fresh = firstValueFrom(service.getDirectory(SYNTHETIC_ORG_ACCOUNT_ID, '365d'));
    const freshRequest = http.expectOne(URL);
    staleRequest.flush(roster('Before Reassign'));
    await stale;

    // A caller arriving now joins the fresh request instead of issuing a third.
    const joined = firstValueFrom(service.getDirectory(SYNTHETIC_ORG_ACCOUNT_ID, '365d'));
    http.expectNone(URL);
    freshRequest.flush(roster('After Reassign'));
    await expect(fresh).resolves.toEqual(roster('After Reassign'));
    await expect(joined).resolves.toEqual(roster('After Reassign'));
  });

  // Each range and filter combination is its own multi-megabyte roster; a lookup for one must drop every expired one.
  it('prunes every expired roster on a lookup, not only the one requested, and refetches after the TTL', async () => {
    const now = vi.spyOn(Date, 'now').mockReturnValue(1_000_000);
    const recent = firstValueFrom(service.getDirectory(SYNTHETIC_ORG_ACCOUNT_ID, '30d'));
    http.expectOne(urlFor('30d')).flush(roster('Recent'));
    await recent;
    const allTime = firstValueFrom(service.getDirectory(SYNTHETIC_ORG_ACCOUNT_ID, 'all'));
    http.expectOne(urlFor('all')).flush(roster('All'));
    await allTime;
    const cache = (service as unknown as { byKey: Map<string, unknown> }).byKey;
    expect(cache.size).toBe(2);

    now.mockReturnValue(1_000_000 + 60_001);
    const next = firstValueFrom(service.getDirectory(SYNTHETIC_ORG_ACCOUNT_ID, '365d'));
    expect(cache.size).toBe(0);
    http.expectOne(URL).flush(roster('Default'));
    await next;
    expect([...cache.keys()]).toEqual([`${SYNTHETIC_ORG_ACCOUNT_ID}:365d:all:all:code:exclude`]);

    const again = firstValueFrom(service.getDirectory(SYNTHETIC_ORG_ACCOUNT_ID, '30d'));
    http.expectOne(urlFor('30d')).flush(roster('Recent Again'));
    await expect(again).resolves.toEqual(roster('Recent Again'));
    now.mockRestore();
  });

  // lfx-self-serve#4163 — one cached roster per time range.
  it('keeps each time range apart and does not serve one range from another', async () => {
    const recent = firstValueFrom(service.getDirectory(SYNTHETIC_ORG_ACCOUNT_ID, '30d'));
    const allTime = firstValueFrom(service.getDirectory(SYNTHETIC_ORG_ACCOUNT_ID, 'all'));
    http.expectOne(urlFor('30d')).flush(roster('Last 30 Days'));
    http.expectOne(urlFor('all')).flush(roster('All Time'));

    await expect(recent).resolves.toEqual(roster('Last 30 Days'));
    await expect(allTime).resolves.toEqual(roster('All Time'));
    await expect(firstValueFrom(service.getDirectory(SYNTHETIC_ORG_ACCOUNT_ID, '30d'))).resolves.toEqual(roster('Last 30 Days'));
    await expect(firstValueFrom(service.getDirectory(SYNTHETIC_ORG_ACCOUNT_ID, 'all'))).resolves.toEqual(roster('All Time'));
    http.expectNone(urlFor('30d'));
    http.expectNone(urlFor('all'));
  });

  it('invalidate() drops the unranged roster and every range of the org, cached or in flight', async () => {
    const cached = firstValueFrom(service.getDirectory(SYNTHETIC_ORG_ACCOUNT_ID, '30d'));
    http.expectOne(urlFor('30d')).flush(roster('Before'));
    await cached;
    const cachedRoster = firstValueFrom(service.getDirectory(SYNTHETIC_ORG_ACCOUNT_ID));
    http.expectOne(ROSTER_URL).flush(roster('Before'));
    await cachedRoster;
    const pending = firstValueFrom(service.getDirectory(SYNTHETIC_ORG_ACCOUNT_ID, 'all'));
    const pendingRequest = http.expectOne(urlFor('all'));

    service.invalidate(SYNTHETIC_ORG_ACCOUNT_ID);
    pendingRequest.flush(roster('Before'));
    await pending;

    const recent = firstValueFrom(service.getDirectory(SYNTHETIC_ORG_ACCOUNT_ID, '30d'));
    const allTime = firstValueFrom(service.getDirectory(SYNTHETIC_ORG_ACCOUNT_ID, 'all'));
    const unranged = firstValueFrom(service.getDirectory(SYNTHETIC_ORG_ACCOUNT_ID));
    http.expectOne(urlFor('30d')).flush(roster('After'));
    http.expectOne(urlFor('all')).flush(roster('After'));
    http.expectOne(ROSTER_URL).flush(roster('After'));
    await expect(recent).resolves.toEqual(roster('After'));
    await expect(allTime).resolves.toEqual(roster('After'));
    await expect(unranged).resolves.toEqual(roster('After'));
  });

  // lfx-self-serve#4164 — one cached roster per commit-filter combination too, all dropped by invalidate().
  it('keeps each commit-filter combination apart, and invalidate() drops every one', async () => {
    const all = firstValueFrom(service.getDirectory(SYNTHETIC_ORG_ACCOUNT_ID, '365d', { projectScope: 'all', commitScope: 'all', metric: 'commits' }));
    const code = firstValueFrom(service.getDirectory(SYNTHETIC_ORG_ACCOUNT_ID, '365d', { projectScope: 'lf', commitScope: 'all', metric: 'code' }));
    http.expectOne(urlFor('365d', 'all', 'all', 'commits')).flush(roster('All Commits'));
    http.expectOne(urlFor('365d', 'lf', 'all', 'code')).flush(roster('LF Code'));
    await expect(all).resolves.toEqual(roster('All Commits'));
    await expect(code).resolves.toEqual(roster('LF Code'));
    await expect(
      firstValueFrom(service.getDirectory(SYNTHETIC_ORG_ACCOUNT_ID, '365d', { projectScope: 'lf', commitScope: 'all', metric: 'code' }))
    ).resolves.toEqual(roster('LF Code'));
    http.expectNone(urlFor('365d', 'lf', 'all', 'code'));

    service.invalidate(SYNTHETIC_ORG_ACCOUNT_ID);

    const refetched = firstValueFrom(service.getDirectory(SYNTHETIC_ORG_ACCOUNT_ID, '365d', { projectScope: 'lf', commitScope: 'all', metric: 'code' }));
    http.expectOne(urlFor('365d', 'lf', 'all', 'code')).flush(roster('After'));
    await expect(refetched).resolves.toEqual(roster('After'));
  });

  // lfx-self-serve#4685
  it('keeps each team members pick apart, team members excluded by default', async () => {
    const filters = { projectScope: 'all', commitScope: 'all', metric: 'code' } as const;
    const excluded = firstValueFrom(service.getDirectory(SYNTHETIC_ORG_ACCOUNT_ID, '365d', filters));
    const included = firstValueFrom(service.getDirectory(SYNTHETIC_ORG_ACCOUNT_ID, '365d', filters, 'include'));
    http.expectOne(urlFor('365d')).flush(roster('Without Team'));
    http.expectOne(urlFor('365d', 'all', 'all', 'code', 'include')).flush(roster('With Team'));

    await expect(excluded).resolves.toEqual(roster('Without Team'));
    await expect(included).resolves.toEqual(roster('With Team'));
  });

  it('does not keep a directory served while the team-member data was unavailable', async () => {
    const first = firstValueFrom(service.getDirectory(SYNTHETIC_ORG_ACCOUNT_ID, '365d'));
    http.expectOne(URL).flush({ ...roster('With Team'), teamMembersUnavailable: true });
    await first;

    const second = firstValueFrom(service.getDirectory(SYNTHETIC_ORG_ACCOUNT_ID, '365d'));
    http.expectOne(URL).flush(roster('Without Team'));
    await expect(second).resolves.toEqual(roster('Without Team'));
  });

  // The reassign pickers keep the pre-#4163 directory: the unranged roster, never a time range.
  it('serves the reassign pickers from the unranged roster, requested without a range and cached apart from 365d', async () => {
    const employees = firstValueFrom(service.getEmployees(SYNTHETIC_ORG_ACCOUNT_ID));
    http.expectOne(ROSTER_URL).flush({ ...roster('Ada Lovelace'), rows: [{ ...roster('Ada Lovelace').rows[0], email: 'ada@example.com' }] });
    await expect(employees).resolves.toEqual([expect.objectContaining({ email: 'ada@example.com' })]);

    const ranged = firstValueFrom(service.getDirectory(SYNTHETIC_ORG_ACCOUNT_ID, '365d'));
    http.expectOne(URL).flush(roster('Last 12 Months'));
    await expect(ranged).resolves.toEqual(roster('Last 12 Months'));

    await firstValueFrom(service.getEmployees(SYNTHETIC_ORG_ACCOUNT_ID));
    http.expectNone(ROSTER_URL);
  });

  // lfx-self-serve#4378: Org Lens access held by someone who left does not make them assignable.
  it('leaves rows tagged former out of the picker while the directory itself still lists them', async () => {
    const [base] = roster('Ada Lovelace').rows;
    const response: OrgAllEmployeesResponse = {
      ...roster('Ada Lovelace'),
      rows: [
        { ...base, email: 'ada@example.com' },
        {
          ...base,
          personKey: 'live-grace',
          name: 'Grace Hopper',
          lfUsername: 'grace',
          email: 'grace@example.com',
          sources: ['access'],
          accessBadge: 'viewer',
          isFormer: true,
        },
      ],
    };

    const employees = firstValueFrom(service.getEmployees(SYNTHETIC_ORG_ACCOUNT_ID));
    http.expectOne(ROSTER_URL).flush(response);

    await expect(employees).resolves.toEqual([expect.objectContaining({ email: 'ada@example.com' })]);
    await expect(firstValueFrom(service.getDirectory(SYNTHETIC_ORG_ACCOUNT_ID))).resolves.toEqual(response);
  });
});

// A rolling deploy (charts/lfx-self-serve/values.yaml, non-sticky requests) serves this bundle against
// pods that predate `keyContactRoles`, so the picker must not hand its callers an undefined `roles`.
describe('OrgPeopleDirectoryStateService.getEmployees — a row that predates keyContactRoles', () => {
  let service: OrgPeopleDirectoryStateService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    service = TestBed.inject(OrgPeopleDirectoryStateService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    http.verify();
  });

  it('gives the picker an empty role list rather than undefined', async () => {
    const response = roster('Ada Lovelace');
    response.rows[0].email = 'ada.tester@vendor-corp.example';
    delete (response.rows[0] as Partial<OrgAllEmployeeRow>).keyContactRoles;

    const pending = firstValueFrom(service.getEmployees(SYNTHETIC_ORG_ACCOUNT_ID));
    http.expectOne({ method: 'GET', url: ROSTER_URL }).flush(response);

    expect((await pending)[0].roles).toEqual([]);
  });
});
