// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { PLATFORM_ID, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { EMPTY_ORG_KEY_CONTACTS_RESPONSE } from '@lfx-one/shared/constants';
import type { OrgKeyContactAssignment, OrgKeyContactsResponse, ReassignKeyContactRolesSubmitEvent } from '@lfx-one/shared/interfaces';
import { AccountContextService } from '@services/account-context.service';
import { OrgEditAccessService } from '@services/org-edit-access.service';
import { OrgLensMembershipsService } from '@services/org-lens-memberships.service';
import { OrgPeopleDirectoryStateService } from '@services/org-people-directory-state.service';
import { PersonDetailDrawerService } from '@services/person-detail-drawer.service';
import { MessageService } from 'primeng/api';
import { DialogService } from 'primeng/dynamicdialog';
import { of, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { SYNTHETIC_ORG_ACCOUNT_ID, SYNTHETIC_ORG_NAME } from '../../../../../../../../e2e/fixtures/mock-data/synthetic-org.mock';
import { KeyContactsService } from '../../services/key-contacts.service';
import { KeyContactsComponent } from './key-contacts.component';

const ORG = SYNTHETIC_ORG_ACCOUNT_ID;

function assignment(over: Partial<OrgKeyContactAssignment> = {}): OrgKeyContactAssignment {
  return {
    contactUid: 'kc-1',
    membershipUid: 'm-1',
    email: 'dclarke@lfx-partner.example',
    firstName: 'Devon',
    lastName: 'Clarke',
    displayName: 'Devon Clarke',
    title: null,
    role: 'Billing Contact',
    foundationSlug: 'cncf',
    foundationName: 'CNCF',
    ...over,
  };
}

function response(assignments: OrgKeyContactAssignment[]): OrgKeyContactsResponse {
  return { ...EMPTY_ORG_KEY_CONTACTS_RESPONSE, assignments };
}

/**
 * `performReassignWrite` is the component's real fan-out — the dialog only hands it the intent — so the
 * tests drive it directly. The branch under test ("invalidate only when at least one write landed")
 * lives in it, and going through the dialog would add a data-pipeline round trip that tests nothing here.
 */
describe('KeyContactsComponent — a landed write drops the cached All Employees roster', () => {
  let fixture: ComponentFixture<KeyContactsComponent>;
  let invalidate: ReturnType<typeof vi.fn>;
  let replaceKeyContactBySlug: ReturnType<typeof vi.fn>;

  const roleOption = () => ({
    key: 'm-1:billing',
    contactUid: 'kc-1',
    contactType: 'billing' as const,
    role: 'Billing Contact',
    pillClass: '',
    foundationSlug: 'cncf',
    foundationName: 'CNCF',
  });

  const intent = (count: number): ReassignKeyContactRolesSubmitEvent => ({
    newPerson: { firstName: 'Avery', lastName: 'Silva', email: 'asilva@lfx-partner.example', jobTitle: null },
    selected: Array.from({ length: count }, () => roleOption()),
  });

  beforeEach(async () => {
    invalidate = vi.fn();
    replaceKeyContactBySlug = vi.fn(() => of({}));
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    await TestBed.configureTestingModule({
      imports: [KeyContactsComponent],
      providers: [
        { provide: PLATFORM_ID, useValue: 'browser' },
        { provide: AccountContextService, useValue: { selectedAccount: signal({ uid: ORG, accountName: SYNTHETIC_ORG_NAME }) } },
        { provide: KeyContactsService, useValue: { getKeyContacts: vi.fn(() => of(response([assignment()]))) } },
        {
          provide: OrgLensMembershipsService,
          useValue: { replaceKeyContactBySlug, addKeyContactBySlug: vi.fn(() => of({})), removeKeyContactBySlug: vi.fn(() => of({})) },
        },
        { provide: OrgPeopleDirectoryStateService, useValue: { invalidate, getDirectory: vi.fn(() => of(null)) } },
        { provide: OrgEditAccessService, useValue: { canEditSelected: signal(true) } },
        { provide: PersonDetailDrawerService, useValue: { open: vi.fn() } },
        { provide: MessageService, useValue: { add: vi.fn() } },
        { provide: DialogService, useValue: { open: vi.fn(() => ({ onClose: of(null), close: vi.fn() })) } },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(KeyContactsComponent);
    await fixture.whenStable();
  });

  function reassign(i: ReassignKeyContactRolesSubmitEvent): Promise<void> {
    const component = fixture.componentInstance as unknown as {
      performReassignWrite: (intent: ReassignKeyContactRolesSubmitEvent, orgUid: string) => Promise<void>;
    };
    return component.performReassignWrite(i, ORG);
  }

  it('invalidates the roster when a reassign lands', async () => {
    await reassign(intent(1));

    expect(invalidate).toHaveBeenCalledWith(ORG);
  });

  it('invalidates when only some of a fan-out landed, since the roster still changed', async () => {
    replaceKeyContactBySlug.mockImplementationOnce(() => of({})).mockImplementationOnce(() => throwError(() => new Error('upstream 500')));

    await reassign(intent(2)).catch(() => undefined);

    expect(invalidate).toHaveBeenCalledWith(ORG);
  });

  // A replace is create-then-delete upstream, so a rejection can still have landed the create — the
  // 409 "added but not removed" case, which tells the user to go and look at the contacts.
  it('invalidates when a single replace fails, since the create may still have landed', async () => {
    replaceKeyContactBySlug.mockImplementation(() => throwError(() => new Error('added but not removed')));
    const component = fixture.componentInstance as unknown as {
      handleReplaceSubmit: (event: unknown, orgUid: string, foundationSlug: string) => Promise<void>;
    };

    await component
      .handleReplaceSubmit(
        {
          editingPersonId: 'kc-1',
          contactType: 'billing',
          person: { email: 'asilva@lfx-partner.example', firstName: 'Avery', lastName: 'Silva', jobTitle: null },
        },
        ORG,
        'cncf'
      )
      .catch(() => undefined);

    expect(invalidate).toHaveBeenCalledWith(ORG);
  });

  // The branch most likely to regress — turning `some` into `every`, or hoisting it above the
  // allSettled, would silently start dropping a roster that never changed.
  it('leaves the roster alone when every write in the fan-out failed', async () => {
    replaceKeyContactBySlug.mockImplementation(() => throwError(() => new Error('upstream 500')));

    await reassign(intent(2)).catch(() => undefined);

    expect(invalidate).not.toHaveBeenCalled();
  });
});
