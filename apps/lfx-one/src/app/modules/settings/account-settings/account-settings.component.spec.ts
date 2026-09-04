// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { PLATFORM_ID, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute } from '@angular/router';
import { EmailManagementData } from '@lfx-one/shared/interfaces';
import { UserService } from '@services/user.service';
import { ConfirmationService, MessageService } from 'primeng/api';
import { DialogService } from 'primeng/dynamicdialog';
import { of, Subject } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AccountSettingsComponent } from './account-settings.component';

/**
 * Guards issue #2177's deep-link consolidation: profile.routes.ts redirects the legacy
 * /profile/email(s)/password pages into /profile/settings with a fragment, and this component
 * reads that fragment to set the active TOC section (and, once email data has loaded, re-scroll).
 */
describe('AccountSettingsComponent — fragment deep-link (#2177)', () => {
  let fragment$: Subject<string | null>;
  let fixture: ComponentFixture<AccountSettingsComponent>;

  beforeEach(async () => {
    fragment$ = new Subject<string | null>();

    const userServiceMock = {
      impersonating: signal(true), // skips the developer-token fetch — irrelevant to this suite
      getUserEmails: vi.fn(() => of(null)),
      getMeetingInviteEmail: vi.fn(() => of({ email_id: null, email: null })),
    };

    TestBed.configureTestingModule({
      imports: [AccountSettingsComponent],
      providers: [
        { provide: PLATFORM_ID, useValue: 'server' }, // no DOM in this suite — scrollToSection's document access is guarded
        { provide: ActivatedRoute, useValue: { snapshot: { data: {} }, fragment: fragment$ } },
        { provide: UserService, useValue: userServiceMock },
        { provide: ConfirmationService, useValue: {} },
        { provide: MessageService, useValue: { add: vi.fn() } },
        { provide: DialogService, useValue: { open: vi.fn() } },
      ],
    });
    // Empty template: exercise the constructor's fragment pipeline without the full section markup.
    // providers: [] clears the component's own @Component providers (ConfirmationService,
    // MessageService, DialogService) so DI falls through to the mocks above instead of shadowing them.
    TestBed.overrideComponent(AccountSettingsComponent, { set: { template: '', imports: [], providers: [] } });

    fixture = TestBed.createComponent(AccountSettingsComponent);
    fixture.detectChanges();
    await fixture.whenStable();
  });

  it('defaults activeSection to email-settings before any fragment arrives', () => {
    expect(fixture.componentInstance.activeSection()).toBe('email-settings');
  });

  it('sets activeSection when a known fragment arrives', () => {
    fragment$.next('password');
    expect(fixture.componentInstance.activeSection()).toBe('password');
  });

  it('ignores an unknown fragment, leaving activeSection unchanged', () => {
    fragment$.next('password');
    fragment$.next('not-a-real-section');
    expect(fixture.componentInstance.activeSection()).toBe('password');
  });

  it('ignores a null fragment', () => {
    fragment$.next('developer-settings');
    fragment$.next(null);
    expect(fixture.componentInstance.activeSection()).toBe('developer-settings');
  });
});

/**
 * Guards the re-scroll race fix itself (PR #2182 review): the suite above runs server-side and
 * never exercises scrollIntoView. This runs on the browser platform with real section elements
 * and asserts the scroll is deferred until the email data finishes loading.
 */
describe('AccountSettingsComponent — deferred re-scroll waits for email load (#2177)', () => {
  it('scrolls to the fragment section only after email data finishes loading', async () => {
    const fragment$ = new Subject<string | null>();
    const emails$ = new Subject<EmailManagementData | null>();

    const userServiceMock = {
      impersonating: signal(true),
      getUserEmails: vi.fn(() => emails$),
      getMeetingInviteEmail: vi.fn(() => of({ email_id: null, email: null })),
    };

    TestBed.configureTestingModule({
      imports: [AccountSettingsComponent],
      providers: [
        { provide: PLATFORM_ID, useValue: 'browser' },
        { provide: ActivatedRoute, useValue: { snapshot: { data: {} }, fragment: fragment$ } },
        { provide: UserService, useValue: userServiceMock },
        { provide: ConfirmationService, useValue: {} },
        { provide: MessageService, useValue: { add: vi.fn() } },
        { provide: DialogService, useValue: { open: vi.fn() } },
      ],
    });
    // providers: [] — see the note in the suite above.
    TestBed.overrideComponent(AccountSettingsComponent, { set: { template: '<div id="password"></div>', imports: [], providers: [] } });

    const fixture = TestBed.createComponent(AccountSettingsComponent);
    fixture.detectChanges();
    await fixture.whenStable();

    const target = fixture.nativeElement.querySelector('#password') as HTMLElement;
    const scrollIntoView = vi.fn();
    target.scrollIntoView = scrollIntoView;

    fragment$.next('password');
    fixture.detectChanges();
    await fixture.whenStable();

    // Still loading (emails$ hasn't emitted/completed yet) — must not have scrolled.
    expect(scrollIntoView).not.toHaveBeenCalled();

    emails$.next({ primary_email: 'a@example.com', alternate_emails: [] } as unknown as EmailManagementData);
    emails$.complete();
    fixture.detectChanges();
    await fixture.whenStable();

    expect(scrollIntoView).toHaveBeenCalledTimes(1);
  });

  it('does not override an explicit TOC click made while email data is still loading (dealako review, PR #2182)', async () => {
    const fragment$ = new Subject<string | null>();
    const emails$ = new Subject<EmailManagementData | null>();

    const userServiceMock = {
      impersonating: signal(true),
      getUserEmails: vi.fn(() => emails$),
      getMeetingInviteEmail: vi.fn(() => of({ email_id: null, email: null })),
    };

    TestBed.configureTestingModule({
      imports: [AccountSettingsComponent],
      providers: [
        { provide: PLATFORM_ID, useValue: 'browser' },
        { provide: ActivatedRoute, useValue: { snapshot: { data: {} }, fragment: fragment$ } },
        { provide: UserService, useValue: userServiceMock },
        { provide: ConfirmationService, useValue: {} },
        { provide: MessageService, useValue: { add: vi.fn() } },
        { provide: DialogService, useValue: { open: vi.fn() } },
      ],
    });
    TestBed.overrideComponent(AccountSettingsComponent, {
      set: { template: '<div id="password"></div><div id="developer-settings"></div>', imports: [], providers: [] },
    });

    const fixture = TestBed.createComponent(AccountSettingsComponent);
    fixture.detectChanges();
    await fixture.whenStable();

    const passwordScroll = vi.fn();
    (fixture.nativeElement.querySelector('#password') as HTMLElement).scrollIntoView = passwordScroll;
    const devScroll = vi.fn();
    (fixture.nativeElement.querySelector('#developer-settings') as HTMLElement).scrollIntoView = devScroll;

    // Deep link lands on #password while email data is still loading.
    fragment$.next('password');
    fixture.detectChanges();
    await fixture.whenStable();

    // User explicitly navigates elsewhere before the load finishes.
    fixture.componentInstance.selectSection('developer-settings');
    expect(devScroll).toHaveBeenCalledTimes(1);
    expect(fixture.componentInstance.activeSection()).toBe('developer-settings');

    // Email data now loads — the deferred re-scroll to #password must not fire and override the click.
    emails$.next({ primary_email: 'a@example.com', alternate_emails: [] } as unknown as EmailManagementData);
    emails$.complete();
    fixture.detectChanges();
    await fixture.whenStable();

    expect(passwordScroll).not.toHaveBeenCalled();
    expect(fixture.componentInstance.activeSection()).toBe('developer-settings');
  });
});
