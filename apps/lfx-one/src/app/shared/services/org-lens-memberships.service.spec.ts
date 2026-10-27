// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import type { AddKeyContactRequest, ReplaceKeyContactRequest } from '@lfx-one/shared/interfaces';
import { firstValueFrom } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SYNTHETIC_ORG_ACCOUNT_ID } from '../../../../e2e/fixtures/mock-data/synthetic-org.mock';
import { OrgLensMembershipsService } from './org-lens-memberships.service';
import { OrgPeopleDirectoryStateService } from './org-people-directory-state.service';

const ORG = SYNTHETIC_ORG_ACCOUNT_ID;
const BASE = `/api/orgs/${ORG}/lens/key-contacts/membership/cncf`;

const body = { contactType: 'billing', email: 'asilva@lfx-partner.example', firstName: 'Avery', lastName: 'Silva', jobTitle: null };

/**
 * The All Employees roster merges key contacts as one of its sources, so any key-contact write changes
 * it — including the role pills the Key Contact column shows. Invalidation lives on these three methods
 * rather than at each call site, because People → Key Contacts and the membership-detail page both
 * write through here, so the two cannot drift.
 */
describe('OrgLensMembershipsService — a key-contact write drops the cached All Employees roster', () => {
  let service: OrgLensMembershipsService;
  let http: HttpTestingController;
  let invalidate: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    invalidate = vi.fn();
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting(), { provide: OrgPeopleDirectoryStateService, useValue: { invalidate } }],
    });
    service = TestBed.inject(OrgLensMembershipsService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    http.verify();
  });

  it('invalidates after a successful add', async () => {
    const pending = firstValueFrom(service.addKeyContactBySlug(ORG, 'cncf', body as AddKeyContactRequest));
    http.expectOne({ method: 'POST', url: BASE }).flush({});
    await pending;

    expect(invalidate).toHaveBeenCalledWith(ORG);
  });

  it('invalidates after a successful remove', async () => {
    const pending = firstValueFrom(service.removeKeyContactBySlug(ORG, 'cncf', 'kc-1'));
    http.expectOne({ method: 'DELETE', url: `${BASE}/kc-1` }).flush({});
    await pending;

    expect(invalidate).toHaveBeenCalledWith(ORG);
  });

  it('invalidates after a successful replace', async () => {
    const pending = firstValueFrom(service.replaceKeyContactBySlug(ORG, 'cncf', 'kc-1', body as ReplaceKeyContactRequest));
    http.expectOne({ method: 'PUT', url: `${BASE}/kc-1` }).flush({});
    await pending;

    expect(invalidate).toHaveBeenCalledWith(ORG);
  });

  // A replace is create-then-delete upstream, so a 409 can mean the create landed and the delete did
  // not. The client cannot tell that from a clean failure, so it drops the roster either way — a
  // needless refetch costs little, a missed one shows a role that has moved.
  it('invalidates when a replace fails, since the create may still have landed', async () => {
    const pending = firstValueFrom(service.replaceKeyContactBySlug(ORG, 'cncf', 'kc-1', body as ReplaceKeyContactRequest)).catch(() => undefined);
    http.expectOne({ method: 'PUT', url: `${BASE}/kc-1` }).flush({ message: 'added but not removed' }, { status: 409, statusText: 'Conflict' });
    await pending;

    expect(invalidate).toHaveBeenCalledWith(ORG);
  });

  it('does not invalidate before the request settles', () => {
    firstValueFrom(service.addKeyContactBySlug(ORG, 'cncf', body as AddKeyContactRequest)).catch(() => undefined);

    expect(invalidate).not.toHaveBeenCalled();
    http.expectOne({ method: 'POST', url: BASE }).flush({});
  });

  it('leaves the roster alone on a read', async () => {
    const pending = firstValueFrom(service.getKeyContactCatalogBySlug(ORG, 'cncf'));
    http.expectOne({ method: 'GET', url: BASE }).flush({});
    await pending;

    expect(invalidate).not.toHaveBeenCalled();
  });
});
