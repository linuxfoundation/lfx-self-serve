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

// M3 — the CLA-only org set is carried as the server sent it; absent (an older server) and a transport failure both mean none.
describe('OrgRoleGrantsService.claManagerOrgSet', () => {
  let service: OrgRoleGrantsService;
  let http: HttpTestingController;
  const grants = { writers: [], auditors: [], isStaff: false };

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    service = TestBed.inject(OrgRoleGrantsService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('carries the claManagerOrgs the server returned', async () => {
    const done = firstValueFrom(service.refresh());
    http.expectOne('/api/orgs/me/role-grants').flush({ ...grants, claManagerOrgs: [UID] });
    await done;

    expect([...service.claManagerOrgSet()]).toEqual([UID]);
  });

  it('is empty when the server omits the field', async () => {
    const done = firstValueFrom(service.refresh());
    http.expectOne('/api/orgs/me/role-grants').flush(grants);
    await done;

    expect(service.claManagerOrgSet().size).toBe(0);
  });

  it('carries a failed CLA-manager lookup, and clears it on the next answer', async () => {
    const failed = firstValueFrom(service.refresh());
    http.expectOne('/api/orgs/me/role-grants').flush({ ...grants, claManagerOrgs: [], claManagerLookup: 'failed' });
    await failed;
    expect(service.claManagerLookupFailed()).toBe(true);

    const ok = firstValueFrom(service.refresh());
    http.expectOne('/api/orgs/me/role-grants').flush({ ...grants, claManagerOrgs: [UID], claManagerLookup: 'ok' });
    await ok;
    expect(service.claManagerLookupFailed()).toBe(false);
  });

  it('is cleared on a transport failure', async () => {
    const first = firstValueFrom(service.refresh());
    http.expectOne('/api/orgs/me/role-grants').flush({ ...grants, claManagerOrgs: [UID] });
    await first;

    const second = firstValueFrom(service.refresh());
    http.expectOne('/api/orgs/me/role-grants').error(new ProgressEvent('error'));
    await second;

    expect(service.claManagerOrgSet().size).toBe(0);
  });
});

// #4225 — `affiliatedToMember` only goes true on a completed verdict naming a member employer. Every
// other answer, and a transport failure, must clear a previously true value, or a caller would keep
// the `affiliated-no-grant` copy after the server stopped asserting it.
describe('OrgRoleGrantsService.affiliatedToMember', () => {
  let service: OrgRoleGrantsService;
  let http: HttpTestingController;
  const grants = { writers: [], auditors: [], isStaff: false };
  const member = { hasEmployer: true, employerIsMember: true, lookup: 'ok' };

  /** Answers one `refresh()` with `body` and waits for the signals to settle. */
  async function answer(body: Record<string, unknown>): Promise<void> {
    const done = firstValueFrom(service.refresh());
    http.expectOne('/api/orgs/me/role-grants').flush(body);
    await done;
  }

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    service = TestBed.inject(OrgRoleGrantsService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('is true for a completed verdict naming a member employer', async () => {
    await answer({ ...grants, affiliation: member });

    expect(service.affiliatedToMember()).toBe(true);
  });

  it('is false when the server omits the field, as an older BFF does', async () => {
    await answer(grants);

    expect(service.affiliatedToMember()).toBe(false);
  });

  it.each([
    ['a failed lookup', { hasEmployer: true, employerIsMember: true, lookup: 'failed' }],
    ['a non-member employer', { hasEmployer: true, employerIsMember: false, lookup: 'ok' }],
    ['no employer at all', { hasEmployer: false, employerIsMember: false, lookup: 'ok' }],
  ])('clears a previously true value on %s', async (_label, affiliation) => {
    await answer({ ...grants, affiliation: member });
    expect(service.affiliatedToMember()).toBe(true);

    await answer({ ...grants, affiliation });

    expect(service.affiliatedToMember()).toBe(false);
  });

  it('clears a previously true value when a later answer omits the field', async () => {
    await answer({ ...grants, affiliation: member });
    expect(service.affiliatedToMember()).toBe(true);

    await answer(grants);

    expect(service.affiliatedToMember()).toBe(false);
  });

  it('is cleared on a transport failure', async () => {
    await answer({ ...grants, affiliation: member });
    expect(service.affiliatedToMember()).toBe(true);

    const second = firstValueFrom(service.refresh());
    http.expectOne('/api/orgs/me/role-grants').error(new ProgressEvent('error'));
    await second;

    expect(service.affiliatedToMember()).toBe(false);
  });
});
