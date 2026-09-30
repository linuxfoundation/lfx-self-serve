// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { EMPTY_ORG_ALL_EMPLOYEE_STATS } from '@lfx-one/shared/constants';
import type { OrgAllEmployeeRow, OrgAllEmployeesResponse } from '@lfx-one/shared/interfaces';
import { firstValueFrom } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { SYNTHETIC_ORG_ACCOUNT_ID } from '../../../../e2e/fixtures/mock-data/synthetic-org.mock';
import { OrgPeopleDirectoryStateService } from './org-people-directory-state.service';

const URL = `/api/orgs/${SYNTHETIC_ORG_ACCOUNT_ID}/lens/people/all?live=true`;

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
    commitsCount: 0,
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
    const first = firstValueFrom(service.getDirectory(SYNTHETIC_ORG_ACCOUNT_ID));
    http.expectOne(URL).flush(roster('Ada Lovelace'));
    await first;

    await expect(firstValueFrom(service.getDirectory(SYNTHETIC_ORG_ACCOUNT_ID))).resolves.toEqual(roster('Ada Lovelace'));
    http.expectNone(URL);
  });

  // A reassign invalidates while a pre-reassign request is still pending. That request must not put
  // the old roster back into the cache when it lands, or the next read would replay it for the TTL.
  it('does not let a request started before invalidate() repopulate the cache', async () => {
    const stale = firstValueFrom(service.getDirectory(SYNTHETIC_ORG_ACCOUNT_ID));
    const staleRequest = http.expectOne(URL);

    service.invalidate(SYNTHETIC_ORG_ACCOUNT_ID);
    staleRequest.flush(roster('Before Reassign'));
    // Its own subscriber still gets the answer it asked for.
    await expect(stale).resolves.toEqual(roster('Before Reassign'));

    const fresh = firstValueFrom(service.getDirectory(SYNTHETIC_ORG_ACCOUNT_ID));
    http.expectOne(URL).flush(roster('After Reassign'));
    await expect(fresh).resolves.toEqual(roster('After Reassign'));
  });

  it('does not let a superseded request drop its successor from the in-flight dedupe', async () => {
    const stale = firstValueFrom(service.getDirectory(SYNTHETIC_ORG_ACCOUNT_ID));
    const staleRequest = http.expectOne(URL);
    service.invalidate(SYNTHETIC_ORG_ACCOUNT_ID);

    const fresh = firstValueFrom(service.getDirectory(SYNTHETIC_ORG_ACCOUNT_ID));
    const freshRequest = http.expectOne(URL);
    staleRequest.flush(roster('Before Reassign'));
    await stale;

    // A caller arriving now joins the fresh request instead of issuing a third.
    const joined = firstValueFrom(service.getDirectory(SYNTHETIC_ORG_ACCOUNT_ID));
    http.expectNone(URL);
    freshRequest.flush(roster('After Reassign'));
    await expect(fresh).resolves.toEqual(roster('After Reassign'));
    await expect(joined).resolves.toEqual(roster('After Reassign'));
  });
});
