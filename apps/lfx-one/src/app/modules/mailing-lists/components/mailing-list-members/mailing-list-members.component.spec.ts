// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpErrorResponse } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { MailingListMemberDeliveryMode, MailingListMemberModStatus, MailingListMemberType } from '@lfx-one/shared/enums';
import type { GroupsIOMailingList, MailingListMember } from '@lfx-one/shared/interfaces';
import { MailingListService } from '@services/mailing-list.service';
import { Confirmation, ConfirmationService, MessageService } from 'primeng/api';
import { DialogService } from 'primeng/dynamicdialog';
import { of, Subject, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { MailingListMembersComponent } from './mailing-list-members.component';

describe('MailingListMembersComponent load recovery', () => {
  const getMembers = vi.fn();

  beforeEach(() => {
    getMembers.mockReset();
    TestBed.configureTestingModule({
      providers: [
        { provide: MailingListService, useValue: { getMembers } },
        { provide: MessageService, useValue: { add: vi.fn() } },
        { provide: DialogService, useValue: { open: vi.fn() } },
        ConfirmationService,
        provideNoopAnimations(),
      ],
    });
  });

  const mount = async () => {
    const fixture = TestBed.createComponent(MailingListMembersComponent);
    fixture.componentRef.setInput('mailingList', { uid: 'list-1' } as GroupsIOMailingList);
    await fixture.whenStable();
    return fixture;
  };

  it('keeps failures visible instead of rendering an empty roster, and retries through the real button', async () => {
    const retry = new Subject<MailingListMember[]>();
    getMembers.mockReturnValueOnce(throwError(() => new HttpErrorResponse({ status: 502 }))).mockReturnValueOnce(retry);
    const fixture = await mount();
    const element = fixture.nativeElement as HTMLElement;

    expect(element.querySelector('[data-testid="mailing-list-members-error"]')?.getAttribute('role')).toBe('alert');
    expect(element.querySelector('[data-testid="mailing-list-members-table"]')).toBeNull();
    expect(element.textContent).not.toContain('No subscribers found');
    element.querySelector<HTMLButtonElement>('[data-testid="mailing-list-members-retry"] button')!.click();
    await fixture.whenStable();

    expect(getMembers).toHaveBeenCalledTimes(2);
    expect(getMembers).toHaveBeenLastCalledWith('list-1');
    expect(fixture.componentInstance.loading()).toBe(true);
    expect(element.querySelector('[data-testid="mailing-list-members-error"]')).toBeNull();
    retry.next([]);
    retry.complete();
    await fixture.whenStable();

    expect(fixture.componentInstance.error()).toBe(false);
    expect(element.querySelector('[data-testid="mailing-list-members-table"]')).not.toBeNull();
    expect(element.textContent).toContain('No subscribers found');
  });

  it('restores the persistent error when a retry fails too', async () => {
    getMembers.mockReturnValue(throwError(() => new HttpErrorResponse({ status: 502 })));
    const fixture = await mount();
    const element = fixture.nativeElement as HTMLElement;
    element.querySelector<HTMLButtonElement>('[data-testid="mailing-list-members-retry"] button')!.click();
    await fixture.whenStable();

    expect(getMembers).toHaveBeenCalledTimes(2);
    expect(element.querySelector('[data-testid="mailing-list-members-error"]')).not.toBeNull();
    expect(element.querySelector('[data-testid="mailing-list-members-table"]')).toBeNull();
  });

  it('preserves the ordinary empty state for a successful empty roster', async () => {
    getMembers.mockReturnValue(of([]));
    const fixture = await mount();
    const element = fixture.nativeElement as HTMLElement;
    expect(element.querySelector('[data-testid="mailing-list-members-error"]')).toBeNull();
    expect(element.textContent).toContain('No subscribers found');
  });
});

describe('MailingListMembersComponent deleteMember (#5644)', () => {
  const MEMBER: MailingListMember = {
    uid: 'member-1',
    mailing_list_uid: 'list-1',
    email: 'jane@example.com',
    first_name: 'Jane',
    last_name: 'Doe',
    member_type: MailingListMemberType.DIRECT,
    delivery_mode: MailingListMemberDeliveryMode.NORMAL,
    mod_status: MailingListMemberModStatus.NONE,
    status: 'active',
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
  };

  const getMembers = vi.fn();
  const deleteMember = vi.fn();
  let messageService: { add: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    getMembers.mockReset().mockReturnValue(of([MEMBER]));
    deleteMember.mockReset();
    messageService = { add: vi.fn() };

    TestBed.configureTestingModule({
      providers: [
        { provide: MailingListService, useValue: { getMembers, deleteMember } },
        { provide: MessageService, useValue: messageService },
        { provide: DialogService, useValue: { open: vi.fn() } },
        // Real class, not a useValue fake — ConfirmDialog touches ConfirmationService's internal
        // Subjects in its constructor (same pattern as committee-settings-tab.component.spec.ts).
        ConfirmationService,
        provideNoopAnimations(),
      ],
    });
  });

  const mount = async () => {
    const fixture = TestBed.createComponent(MailingListMembersComponent);
    fixture.componentRef.setInput('mailingList', { uid: 'list-1', title: 'Test List' } as GroupsIOMailingList);
    await fixture.whenStable();
    return fixture;
  };

  const confirmAndClickDelete = (fixture: Awaited<ReturnType<typeof mount>>) => {
    vi.spyOn(TestBed.inject(ConfirmationService), 'confirm').mockImplementation((confirmation: Confirmation) => {
      confirmation.accept?.();
      return TestBed.inject(ConfirmationService);
    });
    const element = fixture.nativeElement as HTMLElement;
    element.querySelector<HTMLButtonElement>('[data-testid="member-delete-member-1"] button')!.click();
  };

  it('shows the trash button in a loading state while the removal request is in flight', async () => {
    const pending = new Subject<void>();
    deleteMember.mockReturnValue(pending);
    const fixture = await mount();

    confirmAndClickDelete(fixture);
    await fixture.whenStable();

    expect(fixture.componentInstance.deletingUid()).toBe('member-1');
    const trashButton = (fixture.nativeElement as HTMLElement).querySelector('[data-testid="member-delete-member-1"]');
    expect(trashButton?.getAttribute('data-loading')).toBe('true');

    pending.next();
    pending.complete();
    await fixture.whenStable();

    expect(fixture.componentInstance.deletingUid()).toBeNull();
  });

  it('removes the row and toasts once a confirmed removal succeeds', async () => {
    deleteMember.mockReturnValue(of(undefined));
    const fixture = await mount();

    confirmAndClickDelete(fixture);
    await fixture.whenStable();

    expect(deleteMember).toHaveBeenCalledWith('list-1', 'member-1');
    expect(fixture.componentInstance.members()).toHaveLength(0);
    expect(fixture.componentInstance.deletingUid()).toBeNull();
    expect(messageService.add).toHaveBeenCalledWith(expect.objectContaining({ severity: 'success' }));
  });

  it('keeps the row, clears the loading state and toasts an error when removal fails', async () => {
    deleteMember.mockReturnValue(throwError(() => new HttpErrorResponse({ status: 500 })));
    const fixture = await mount();

    confirmAndClickDelete(fixture);
    await fixture.whenStable();

    expect(fixture.componentInstance.members()).toHaveLength(1);
    expect(fixture.componentInstance.deletingUid()).toBeNull();
    expect(messageService.add).toHaveBeenCalledWith(expect.objectContaining({ severity: 'error' }));
  });
});
