// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpErrorResponse } from '@angular/common/http';
import { PLATFORM_ID, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute } from '@angular/router';
import { MEETING_INVITE_PRIMARY_SENTINEL } from '@lfx-one/shared/constants';
import { EmailManagementData, MeetingInviteEmail, UserEmail } from '@lfx-one/shared/interfaces';
import { UserService } from '@services/user.service';
import { ConfirmationService, MessageService } from 'primeng/api';
import { DialogService } from 'primeng/dynamicdialog';
import { Observable, of, Subject, throwError } from 'rxjs';
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

/**
 * Guards the client-side meeting-invite selection and delete-guard invariants (Copilot review,
 * PR #1073): the primary row sends the reset sentinel, a write-in-flight blocks a second
 * selection, both error paths surface to the right UI element, and delete stays blocked whenever
 * the target is (or might be, on a failed lookup) the current meeting-invite address.
 */
describe('AccountSettingsComponent — meeting-invite selection & delete guard (Copilot review, PR #1073)', () => {
  const PRIMARY_EMAIL: UserEmail = { email: 'primary@example.com', verified: true };
  const ALT_EMAIL: UserEmail = { email: 'alt@example.com', verified: true, user_id: 'user-alt' };

  interface UserServiceMockOptions {
    invite?: MeetingInviteEmail | 'error';
    setMeetingInviteEmail?: (email: string) => Observable<MeetingInviteEmail>;
    rejectIdentity?: ReturnType<typeof vi.fn>;
    authorized?: boolean;
  }

  function makeUserServiceMock(opts: UserServiceMockOptions = {}): Record<string, unknown> {
    const invite = opts.invite ?? { email_id: null, email: null };
    return {
      // Skips the developer-token fetch (irrelevant here) — same trick the suites above use.
      impersonating: signal(true),
      getUserEmails: vi.fn(() => of<EmailManagementData>({ primary_email: PRIMARY_EMAIL.email, alternate_emails: [ALT_EMAIL] })),
      getMeetingInviteEmail: vi.fn(() => (invite === 'error' ? throwError(() => new Error('nats down')) : of(invite))),
      setMeetingInviteEmail: vi.fn(opts.setMeetingInviteEmail ?? ((email: string) => of({ email_id: null, email }))),
      getProfileAuthStatus: vi.fn(() => of({ authorized: opts.authorized ?? true, configured: true })),
      rejectIdentity: opts.rejectIdentity ?? vi.fn(() => of({ success: true })),
    };
  }

  async function setup(
    userServiceMock: Record<string, unknown>,
    confirmationServiceMock: Partial<ConfirmationService> = { confirm: vi.fn() }
  ): Promise<ComponentFixture<AccountSettingsComponent>> {
    TestBed.configureTestingModule({
      imports: [AccountSettingsComponent],
      providers: [
        { provide: PLATFORM_ID, useValue: 'browser' },
        { provide: ActivatedRoute, useValue: { snapshot: { data: {} }, fragment: of(null) } },
        { provide: UserService, useValue: userServiceMock },
        { provide: ConfirmationService, useValue: confirmationServiceMock },
        { provide: MessageService, useValue: { add: vi.fn() } },
        { provide: DialogService, useValue: { open: vi.fn() } },
      ],
    });
    // Empty template: exercise setMeetingInvite/deleteEmail directly without the full section markup.
    TestBed.overrideComponent(AccountSettingsComponent, { set: { template: '', imports: [], providers: [] } });

    const fixture = TestBed.createComponent(AccountSettingsComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    return fixture;
  }

  it('sends the reset sentinel when the primary row is selected while an override is active', async () => {
    const userServiceMock = makeUserServiceMock({ invite: { email_id: 'id-1', email: ALT_EMAIL.email } });
    const fixture = await setup(userServiceMock);

    fixture.componentInstance.setMeetingInvite(PRIMARY_EMAIL);

    expect(userServiceMock['setMeetingInviteEmail']).toHaveBeenCalledWith(MEETING_INVITE_PRIMARY_SENTINEL);
  });

  it('sends the literal address when a non-primary row is selected', async () => {
    const userServiceMock = makeUserServiceMock({ invite: { email_id: null, email: null } });
    const fixture = await setup(userServiceMock);

    fixture.componentInstance.setMeetingInvite(ALT_EMAIL);

    expect(userServiceMock['setMeetingInviteEmail']).toHaveBeenCalledWith(ALT_EMAIL.email);
  });

  it('blocks a second selection while the first write is still in flight', async () => {
    const inFlight = new Subject<MeetingInviteEmail>();
    const setMeetingInviteEmail = vi.fn(() => inFlight);
    const userServiceMock = makeUserServiceMock({ invite: { email_id: null, email: null } });
    userServiceMock['setMeetingInviteEmail'] = setMeetingInviteEmail;
    const fixture = await setup(userServiceMock);

    fixture.componentInstance.setMeetingInvite(ALT_EMAIL);
    expect(fixture.componentInstance.savingMeetingInvite()).toBe(true);

    fixture.componentInstance.setMeetingInvite(PRIMARY_EMAIL);

    // The second call must not have reached the service, no matter what it would have sent.
    expect(setMeetingInviteEmail).toHaveBeenCalledTimes(1);
  });

  it('surfaces a 400 failure as the inline banner, not a toast', async () => {
    const messageServiceMock = { add: vi.fn() };
    const userServiceMock = makeUserServiceMock({
      invite: { email_id: null, email: null },
      setMeetingInviteEmail: () => throwError(() => new HttpErrorResponse({ status: 400, error: { message: 'not an active address' } })),
    });
    TestBed.configureTestingModule({
      imports: [AccountSettingsComponent],
      providers: [
        { provide: PLATFORM_ID, useValue: 'browser' },
        { provide: ActivatedRoute, useValue: { snapshot: { data: {} }, fragment: of(null) } },
        { provide: UserService, useValue: userServiceMock },
        { provide: ConfirmationService, useValue: { confirm: vi.fn() } },
        { provide: MessageService, useValue: messageServiceMock },
        { provide: DialogService, useValue: { open: vi.fn() } },
      ],
    });
    TestBed.overrideComponent(AccountSettingsComponent, { set: { template: '', imports: [], providers: [] } });
    const fixture = TestBed.createComponent(AccountSettingsComponent);
    fixture.detectChanges();
    await fixture.whenStable();

    fixture.componentInstance.setMeetingInvite(ALT_EMAIL);

    expect(fixture.componentInstance.meetingInviteError()).toBe('not an active address');
    expect(messageServiceMock.add).not.toHaveBeenCalled();
  });

  it('surfaces a non-400 failure as a toast, not the inline banner', async () => {
    const messageServiceMock = { add: vi.fn() };
    const userServiceMock = makeUserServiceMock({
      invite: { email_id: null, email: null },
      setMeetingInviteEmail: () => throwError(() => new HttpErrorResponse({ status: 503, error: { message: 'try again later' } })),
    });
    TestBed.configureTestingModule({
      imports: [AccountSettingsComponent],
      providers: [
        { provide: PLATFORM_ID, useValue: 'browser' },
        { provide: ActivatedRoute, useValue: { snapshot: { data: {} }, fragment: of(null) } },
        { provide: UserService, useValue: userServiceMock },
        { provide: ConfirmationService, useValue: { confirm: vi.fn() } },
        { provide: MessageService, useValue: messageServiceMock },
        { provide: DialogService, useValue: { open: vi.fn() } },
      ],
    });
    TestBed.overrideComponent(AccountSettingsComponent, { set: { template: '', imports: [], providers: [] } });
    const fixture = TestBed.createComponent(AccountSettingsComponent);
    fixture.detectChanges();
    await fixture.whenStable();

    fixture.componentInstance.setMeetingInvite(ALT_EMAIL);

    expect(fixture.componentInstance.meetingInviteError()).toBeNull();
    // The 503's own body is deliberately dropped in favour of the caller's fallback: `extractErrorMessage`
    // stopped reading 5xx bodies because they are overwhelmingly the envelope's "Internal server error"
    // or a Go-service string forwarded verbatim, neither of which names the action that failed.
    expect(messageServiceMock.add).toHaveBeenCalledWith(expect.objectContaining({ severity: 'error', detail: 'Failed to update meeting invitation email' }));
  });

  it('fails closed and skips the delete flow entirely when the invite lookup itself failed', async () => {
    const rejectIdentity = vi.fn(() => of({ success: true }));
    const userServiceMock = makeUserServiceMock({ invite: 'error', rejectIdentity });
    const fixture = await setup(userServiceMock);

    fixture.componentInstance.deleteEmail(ALT_EMAIL);
    await fixture.whenStable();

    expect(userServiceMock['getProfileAuthStatus']).not.toHaveBeenCalled();
    expect(rejectIdentity).not.toHaveBeenCalled();
  });

  it('blocks deleting the address currently pinned as the meeting-invite email', async () => {
    const rejectIdentity = vi.fn(() => of({ success: true }));
    const userServiceMock = makeUserServiceMock({ invite: { email_id: 'id-1', email: ALT_EMAIL.email }, rejectIdentity });
    const fixture = await setup(userServiceMock);

    fixture.componentInstance.deleteEmail(ALT_EMAIL);
    await fixture.whenStable();

    expect(userServiceMock['getProfileAuthStatus']).not.toHaveBeenCalled();
    expect(rejectIdentity).not.toHaveBeenCalled();
  });

  it('deletes normally and forwards the email once confirmed, when no override protects the address', async () => {
    const rejectIdentity = vi.fn(() => of({ success: true }));
    const userServiceMock = makeUserServiceMock({ invite: { email_id: null, email: null }, rejectIdentity });
    const confirmationServiceMock: Partial<ConfirmationService> = {
      confirm: vi.fn((params) => params.accept?.()),
    };
    const fixture = await setup(userServiceMock, confirmationServiceMock);

    fixture.componentInstance.deleteEmail(ALT_EMAIL);
    await fixture.whenStable();

    expect(rejectIdentity).toHaveBeenCalledWith('auth0:user-alt', 'email', 'user-alt', ALT_EMAIL.email);
  });
});
