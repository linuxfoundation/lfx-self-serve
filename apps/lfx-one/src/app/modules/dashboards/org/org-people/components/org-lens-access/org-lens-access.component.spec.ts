// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import type { OrgAccessListResponse, OrgAccessUser } from '@lfx-one/shared/interfaces';
import { AccountContextService } from '@services/account-context.service';
import { OrgLensAccessService } from '@services/org-lens-access.service';
import { PersonDetailDrawerService } from '@services/person-detail-drawer.service';
import { ConfirmationService, MessageService } from 'primeng/api';
import { of } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { SYNTHETIC_ORG_ACCOUNT_ID, SYNTHETIC_ORG_NAME } from '../../../../../../../../e2e/fixtures/mock-data/synthetic-org.mock';
import { OrgLensAccessComponent } from './org-lens-access.component';

const MARKUP_NAME = '<img src="https://h.example/p.gif"><a href="https://h.example">x</a>';

function accessUser(overrides: Partial<OrgAccessUser>): OrgAccessUser {
  return {
    email: 'ada@acme-motors.example',
    username: 'ada',
    name: 'Ada Lovelace',
    initials: 'AL',
    avatarUrl: null,
    jobTitle: null,
    role: 'admin',
    inviteStatus: 'accepted',
    isPending: false,
    ...overrides,
  };
}

describe('OrgLensAccessComponent — remove confirmation', () => {
  let fixture: ComponentFixture<OrgLensAccessComponent>;

  afterEach(() => fixture?.destroy());

  async function mount(users: OrgAccessUser[]): Promise<void> {
    const list: OrgAccessListResponse = {
      orgUid: SYNTHETIC_ORG_ACCOUNT_ID,
      users,
      summary: {
        totalUsers: users.length,
        administrators: users.filter((u) => u.role === 'admin').length,
        viewers: users.filter((u) => u.role === 'viewer').length,
      },
      canManage: true,
    };
    await TestBed.configureTestingModule({
      imports: [OrgLensAccessComponent],
      providers: [
        provideNoopAnimations(),
        ConfirmationService,
        { provide: MessageService, useValue: { add: vi.fn() } },
        { provide: AccountContextService, useValue: { selectedAccount: signal({ uid: SYNTHETIC_ORG_ACCOUNT_ID, accountName: SYNTHETIC_ORG_NAME }) } },
        { provide: OrgLensAccessService, useValue: { getAccessUsers: vi.fn(() => of(list)) } },
        { provide: PersonDetailDrawerService, useValue: { open: vi.fn() } },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(OrgLensAccessComponent);
    fixture.detectChanges();
    await fixture.whenStable();
  }

  it('renders a markup-bearing display name as literal text, creating no elements from it', async () => {
    const target = accessUser({ email: 'grace@acme-motors.example', username: 'grace', name: MARKUP_NAME, role: 'viewer' });
    await mount([accessUser({}), target]);

    (fixture.componentInstance as unknown as { confirmRemove(user: OrgAccessUser): void }).confirmRemove(target);
    fixture.detectChanges();
    await fixture.whenStable();

    // Queried by PrimeNG's own class rather than our template's test id, so a regression back to the
    // default [innerHTML] message still finds the dialog and fails on the injected elements.
    const dialog = document.body.querySelector<HTMLElement>('.p-confirmdialog');
    expect(dialog).not.toBeNull();
    expect(dialog?.querySelector('img')).toBeNull();
    expect(dialog?.querySelector('a')).toBeNull();
    expect(dialog?.querySelector('[data-testid="org-lens-access-remove-confirm-message"]')?.textContent).toContain(MARKUP_NAME);
  });
});
