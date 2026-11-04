// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpErrorResponse } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import type { GroupsIOMailingList, MailingListMember } from '@lfx-one/shared/interfaces';
import { MailingListService } from '@services/mailing-list.service';
import { ConfirmationService, MessageService } from 'primeng/api';
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
