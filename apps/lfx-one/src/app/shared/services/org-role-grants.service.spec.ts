// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { firstValueFrom } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { OrgRoleGrantsService } from './org-role-grants.service';

const UID = '0014100000TdzA7AAJ';
const URL = `/api/orgs/${UID}/lens/read-check`;

// #2961 — only the read gate's own refusal may render contractor-no-grant. Anything else (the gate
// could not verify, a network failure) is an outage, and must never tell a contractor they lack a grant.
describe('OrgRoleGrantsService.readCheck', () => {
  let service: OrgRoleGrantsService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    service = TestBed.inject(OrgRoleGrantsService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('answers admitted when the gate lets the request through', async () => {
    const answer = firstValueFrom(service.readCheck(UID));
    http.expectOne(URL).flush(null, { status: 204, statusText: 'No Content' });

    expect(await answer).toBe(true);
  });

  it('answers refused only for the gate\u2019s 403 FORBIDDEN', async () => {
    const answer = firstValueFrom(service.readCheck(UID));
    http.expectOne(URL).flush({ code: 'FORBIDDEN', message: 'no access' }, { status: 403, statusText: 'Forbidden' });

    expect(await answer).toBe(false);
  });

  it('does not treat an unverifiable check or a bare 403 as a refusal', async () => {
    const unverifiable = firstValueFrom(service.readCheck(UID));
    http.expectOne(URL).flush({ code: 'ROLE_GRANTS_UNAVAILABLE' }, { status: 503, statusText: 'Service Unavailable' });
    expect(await unverifiable).toBe(true);

    const bare = firstValueFrom(service.readCheck(UID));
    http.expectOne(URL).flush('Forbidden', { status: 403, statusText: 'Forbidden' });
    expect(await bare).toBe(true);
  });
});

// #3136 — the inverse posture of readCheck: the edit answer only shows or hides controls, so anything but
// an explicit `canEdit: true` (including an unverifiable check) must hide them.
describe('OrgRoleGrantsService.editCheck', () => {
  const EDIT_URL = `/api/orgs/${UID}/lens/edit-check`;
  let service: OrgRoleGrantsService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    service = TestBed.inject(OrgRoleGrantsService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('answers the server decision', async () => {
    const yes = firstValueFrom(service.editCheck(UID));
    http.expectOne(EDIT_URL).flush({ canEdit: true });
    expect(await yes).toBe(true);

    const no = firstValueFrom(service.editCheck(UID));
    http.expectOne(EDIT_URL).flush({ canEdit: false });
    expect(await no).toBe(false);
  });

  it('fails closed on any error, unlike the read check', async () => {
    const refused = firstValueFrom(service.editCheck(UID));
    http.expectOne(EDIT_URL).flush({ code: 'FORBIDDEN' }, { status: 403, statusText: 'Forbidden' });
    expect(await refused).toBe(false);

    const unavailable = firstValueFrom(service.editCheck(UID));
    http.expectOne(EDIT_URL).flush({ code: 'ROLE_GRANTS_UNAVAILABLE' }, { status: 503, statusText: 'Service Unavailable' });
    expect(await unavailable).toBe(false);
  });
});
