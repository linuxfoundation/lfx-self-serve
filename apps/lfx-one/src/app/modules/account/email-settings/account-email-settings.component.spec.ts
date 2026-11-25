// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { DIALOG_DATA, DialogRef } from '@angular/cdk/dialog';
import { Component, PLATFORM_ID, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { ActivatedRoute } from '@angular/router';
import { ACCOUNT_EMAIL_SETTINGS_COPY, ACCOUNT_SETTINGS_SECTIONS } from '@lfx-one/shared/constants';
import { EmailManagementData } from '@lfx-one/shared/interfaces';
import { FeatureFlagService } from '@services/feature-flag.service';
import { UserService } from '@services/user.service';
import { UiModalService } from '@shared/uikit/modal/modal.service';
import { ConfirmationService, MessageService } from 'primeng/api';
import { DialogService } from 'primeng/dynamicdialog';
import { of, Subject } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { AccountEmailSettingsComponent } from './account-email-settings.component';
import { AccountDeleteEmailDialogComponent } from './delete-email-dialog/account-delete-email-dialog.component';

const EMAILS: EmailManagementData = {
  primary_email: 'ada@lovelace.example',
  alternate_emails: [
    { email: 'ada@work.example', verified: true, user_id: 'u-work' },
    { email: 'ada@invites.example', verified: true, user_id: 'u-invites' },
  ],
} as EmailManagementData;

/** State-only page: no template, so these tests cost no render. Providers are not inherited, so the page's own is repeated. */
@Component({ selector: 'lfx-test-account-email-settings', template: '', providers: [DialogService] })
class StateEmailSettingsComponent extends AccountEmailSettingsComponent {}

describe('AccountEmailSettingsComponent', () => {
  function setup(invite: string | null = 'ada@invites.example') {
    const closed = new Subject<boolean | undefined>();
    const open = vi.fn(() => ({ closed }));
    TestBed.configureTestingModule({
      providers: [
        provideNoopAnimations(),
        { provide: PLATFORM_ID, useValue: 'browser' },
        {
          provide: ActivatedRoute,
          useValue: { snapshot: { data: { embedded: true, section: ACCOUNT_SETTINGS_SECTIONS.EMAIL_SETTINGS } }, fragment: of(null) },
        },
        {
          provide: UserService,
          useValue: {
            impersonating: signal(false),
            getUserEmails: vi.fn(() => of(EMAILS)),
            getMeetingInviteEmail: vi.fn(() => of({ email_id: invite ? 'e-1' : null, email: invite })),
          },
        },
        { provide: FeatureFlagService, useValue: { getBooleanFlag: () => signal(false) } },
        { provide: MessageService, useValue: { add: vi.fn(), messageObserver: of(), clearObserver: of() } },
        { provide: ConfirmationService, useValue: {} },
        { provide: UiModalService, useValue: { open } },
      ],
    });
    return { open, closed };
  }

  it('offers each address what it allows, with the design’s reasons Delete is off', async () => {
    setup();
    const fixture = TestBed.createComponent(StateEmailSettingsComponent);
    await fixture.whenStable();
    const [primary, work, invites] = fixture.componentInstance['rows']();

    expect(primary).toMatchObject({
      isPrimary: true,
      canMakePrimary: false,
      showDelete: true,
      deleteBlockedReason: ACCOUNT_EMAIL_SETTINGS_COPY.deletePrimaryReason,
    });
    expect(work).toMatchObject({ canMakePrimary: true, canSetMeetingInvite: true, showDelete: true, deleteBlockedReason: '' });
    expect(invites).toMatchObject({ isMeetingInvite: true, canSetMeetingInvite: false, deleteBlockedReason: ACCOUNT_EMAIL_SETTINGS_COPY.deleteInviteReason });
  });

  it('holds every Delete while a meeting-invitation change is in flight', async () => {
    setup(null);
    const fixture = TestBed.createComponent(StateEmailSettingsComponent);
    await fixture.whenStable();
    fixture.componentInstance.savingMeetingInvite.set(true);

    const work = fixture.componentInstance['rows']()[1];
    expect(work.meetingInviteBusy).toBe(true);
    expect(work.deleteBlockedReason).toContain('Updating the meeting-invitation email');
  });

  it('asks in its own dialog before a delete, and deletes only on yes', async () => {
    const { open, closed } = setup();
    const fixture = TestBed.createComponent(StateEmailSettingsComponent);
    await fixture.whenStable();
    const accept = vi.fn();
    const reject = vi.fn();

    fixture.componentInstance['confirmDeleteEmail']('ada@work.example', accept, reject);
    expect(open).toHaveBeenCalledWith(AccountDeleteEmailDialogComponent, expect.objectContaining({ data: { email: 'ada@work.example' } }));
    closed.next(undefined);

    expect(reject).toHaveBeenCalled();
    expect(accept).not.toHaveBeenCalled();

    fixture.componentInstance['confirmDeleteEmail']('ada@work.example', accept, reject);
    closed.next(true);
    expect(accept).toHaveBeenCalledTimes(1);
  });

  it('lists each address with its badges, the primary’s hint and the add form', async () => {
    setup();
    const fixture = TestBed.createComponent(AccountEmailSettingsComponent);
    await fixture.whenStable();
    const host = fixture.nativeElement as HTMLElement;
    const row = (email: string) => host.querySelector(`[data-testid="account-email-settings-row-${email}"]`) as HTMLElement;

    expect(host.textContent).toContain(ACCOUNT_EMAIL_SETTINGS_COPY.subtitle);
    expect(row('ada@lovelace.example').textContent).toContain('Primary');
    expect(row('ada@lovelace.example').textContent).toContain(ACCOUNT_EMAIL_SETTINGS_COPY.primaryHint);
    expect(row('ada@invites.example').querySelector('[data-testid="account-email-settings-meeting-invites"]')).not.toBeNull();
    expect(row('ada@work.example').querySelector('[data-testid="account-email-settings-verified"]')?.textContent).toContain('Verified');
    expect(host.querySelector('[data-testid="account-email-settings-add-form"]')).not.toBeNull();
  });

  it('moves the “No code yet?” hint into a note with a Contact support button', async () => {
    setup();
    const fixture = TestBed.createComponent(AccountEmailSettingsComponent);
    await fixture.whenStable();
    fixture.componentInstance.pendingEmail.set('new@ada.example');
    fixture.componentInstance.otpStep.set(true);
    await fixture.whenStable();
    const host = fixture.nativeElement as HTMLElement;

    expect(host.querySelector('[data-testid="account-email-settings-code-hint"]')?.textContent).toContain(fixture.componentInstance.codeNotReceivedTitle);
    expect(host.querySelector('[data-testid="account-email-settings-code-support"]')?.textContent).toContain('Contact support');
  });
});

describe('AccountDeleteEmailDialogComponent', () => {
  it('names the address and deletes it on “Delete email address”', async () => {
    const close = vi.fn();
    TestBed.configureTestingModule({
      providers: [
        { provide: DialogRef, useValue: { close, id: 'delete-email' } },
        { provide: DIALOG_DATA, useValue: { email: 'ada@work.example' } },
      ],
    });
    const fixture = TestBed.createComponent(AccountDeleteEmailDialogComponent);
    await fixture.whenStable();
    const host = fixture.nativeElement as HTMLElement;

    expect(host.textContent).toContain(ACCOUNT_EMAIL_SETTINGS_COPY.deleteTitle);
    expect(host.querySelector('[data-testid="account-delete-email-text"]')?.textContent).toContain('ada@work.example will be removed from your account.');
    (host.querySelector('[data-testid="account-delete-email-confirm"] button') as HTMLButtonElement).click();
    expect(close).toHaveBeenCalledWith(true);
  });
});
