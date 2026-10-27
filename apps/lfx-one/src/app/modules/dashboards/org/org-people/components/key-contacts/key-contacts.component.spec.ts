// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { PLATFORM_ID, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import type { OrgKeyContactAssignment, OrgKeyContactsResponse, PersonDrawerContext } from '@lfx-one/shared/interfaces';
import { AccountContextService } from '@services/account-context.service';
import { OrgEditAccessService } from '@services/org-edit-access.service';
import { OrgLensMembershipsService } from '@services/org-lens-memberships.service';
import { PersonDetailDrawerService } from '@services/person-detail-drawer.service';
import { DialogService } from 'primeng/dynamicdialog';
import { MessageService } from 'primeng/api';
import { Subject } from 'rxjs';
import { beforeEach, describe, expect, it, type Mock, vi } from 'vitest';

import { SYNTHETIC_ORG_ACCOUNT_ID, SYNTHETIC_ORG_NAME } from '../../../../../../../../e2e/fixtures/mock-data/synthetic-org.mock';
import { KeyContactsService } from '../../services/key-contacts.service';
import { KeyContactsComponent } from './key-contacts.component';

const FIRST_EMAIL = 'ada.tester@vendor-corp.example';
const SECOND_EMAIL = 'ada.tester+ops@vendor-corp.example';

function assignment(overrides: Partial<OrgKeyContactAssignment>): OrgKeyContactAssignment {
  return {
    contactUid: 'kc-1',
    membershipUid: 'msp-1',
    email: FIRST_EMAIL,
    firstName: 'Ada',
    lastName: 'Tester',
    displayName: 'Ada Tester',
    title: 'Director, Open Source',
    role: 'Billing Contact',
    foundationSlug: 'foundation-one',
    foundationName: 'Foundation One',
    ...overrides,
  };
}

describe('KeyContactsComponent — roles handed to the person drawer', () => {
  let getKeyContacts: Mock<(orgUid: string) => Subject<OrgKeyContactsResponse>>;
  let responses: Subject<OrgKeyContactsResponse>;
  let open: Mock<(context: PersonDrawerContext) => void>;
  let fixture: ComponentFixture<KeyContactsComponent>;

  async function mount(assignments: OrgKeyContactAssignment[]): Promise<void> {
    responses = new Subject<OrgKeyContactsResponse>();
    getKeyContacts = vi.fn(() => responses);
    open = vi.fn();
    await TestBed.configureTestingModule({
      imports: [KeyContactsComponent],
      providers: [
        { provide: PLATFORM_ID, useValue: 'browser' },
        { provide: AccountContextService, useValue: { selectedAccount: signal({ uid: SYNTHETIC_ORG_ACCOUNT_ID, accountName: SYNTHETIC_ORG_NAME }) } },
        { provide: KeyContactsService, useValue: { getKeyContacts } },
        { provide: OrgLensMembershipsService, useValue: { getKeyContactCatalogBySlug: vi.fn() } },
        { provide: OrgEditAccessService, useValue: { canEditSelected: signal(false) } },
        { provide: PersonDetailDrawerService, useValue: { open } },
        { provide: MessageService, useValue: { add: vi.fn() } },
        { provide: DialogService, useValue: { open: vi.fn() } },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(KeyContactsComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    responses.next({ assignments, stats: { individualCount: 1, foundationsCovered: 1, unfilledRequiredRoleCount: 0 } });
    fixture.detectChanges();
    await fixture.whenStable();
  }

  /** Click the main row for one address. */
  function clickPerson(email: string): void {
    const name = fixture.nativeElement.querySelector(`[data-testid="org-people-key-contacts-name-${email}"]`) as HTMLElement | null;
    expect(name).not.toBeNull();
    name?.click();
  }

  beforeEach(() => {
    TestBed.resetTestingModule();
  });

  // Rows are grouped by address, so one person on two addresses is two rows. The drawer is about the
  // person, so it gets every role their username holds — and the username's stored case must not matter,
  // since `agreedUsername` hands back the source's spelling rather than a normalized one.
  it.each(['ATester', 'atester', 'ATESTER'])('gathers roles across both address rows for the username %o', async (username) => {
    await mount([assignment({ contactUid: 'kc-billing', username }), assignment({ contactUid: 'kc-pr', email: SECOND_EMAIL, role: 'PR Contact', username })]);

    clickPerson(FIRST_EMAIL);

    expect(open).toHaveBeenCalledTimes(1);
    const context = open.mock.calls[0][0];
    expect(context.defaultTab).toBe('key-contacts');
    expect(context.keyContactAssignments?.map((a) => a.role).sort()).toEqual(['Billing Contact', 'PR Contact']);
  });

  // No agreed username is no identity to gather on, so only the clicked row's roles may be attributed.
  it('falls back to the clicked row when the rows agree on no username', async () => {
    await mount([
      assignment({ contactUid: 'kc-billing', username: null }),
      assignment({ contactUid: 'kc-pr', email: SECOND_EMAIL, role: 'PR Contact', username: null }),
    ]);

    clickPerson(FIRST_EMAIL);

    const context = open.mock.calls[0][0];
    expect(context.username).toBeNull();
    expect(context.keyContactAssignments?.map((a) => a.role)).toEqual(['Billing Contact']);
  });
});
