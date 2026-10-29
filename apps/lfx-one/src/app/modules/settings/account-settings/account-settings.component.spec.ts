// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpErrorResponse } from '@angular/common/http';
import { PLATFORM_ID, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute } from '@angular/router';
import { EMAIL_ALREADY_CONNECTED_MESSAGE, EMAIL_CODE_NOT_RECEIVED_HINT, EMAIL_VERIFICATION_SENT_MESSAGE, ERROR_CODES } from '@lfx-one/shared/constants';
import { EmailManagementData, MeetingInviteEmail, SendEmailVerificationResponse, UserEmail, VerifyAndLinkEmailResponse } from '@lfx-one/shared/interfaces';
import { FeatureFlagService } from '@services/feature-flag.service';
import { IntercomService } from '@services/intercom.service';
import { UserService } from '@services/user.service';
import { ConfirmationService, MessageService } from 'primeng/api';
import { DialogService } from 'primeng/dynamicdialog';
import { Observable, of, Subject, throwError } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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
 * PR #1073): the primary row pins its literal address (#3983), a write-in-flight blocks a second
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

  it('pins the literal primary address, not the sentinel, when the primary row is selected (#3983)', async () => {
    const userServiceMock = makeUserServiceMock({ invite: { email_id: 'id-1', email: ALT_EMAIL.email } });
    const fixture = await setup(userServiceMock);

    fixture.componentInstance.setMeetingInvite(PRIMARY_EMAIL);

    expect(userServiceMock['setMeetingInviteEmail']).toHaveBeenCalledWith(PRIMARY_EMAIL.email);
  });

  it('sends the literal address when a non-primary row is selected', async () => {
    const userServiceMock = makeUserServiceMock({ invite: { email_id: null, email: null } });
    const fixture = await setup(userServiceMock);

    fixture.componentInstance.setMeetingInvite(ALT_EMAIL);

    expect(userServiceMock['setMeetingInviteEmail']).toHaveBeenCalledWith(ALT_EMAIL.email);
  });

  describe('badge and primary-row action (#3559)', () => {
    function rowFor(fixture: ComponentFixture<AccountSettingsComponent>, address: string) {
      return fixture.componentInstance.emailsWithMetadata().find((e) => e.email === address)!;
    }

    function menuLabelsFor(fixture: ComponentFixture<AccountSettingsComponent>, address: string): (string | undefined)[] {
      return (fixture.componentInstance.menuItemsMap().get(address) ?? []).map((item) => item.label);
    }

    it('badges the primary row and offers it no invite action while no override is set', async () => {
      const fixture = await setup(makeUserServiceMock({ invite: { email_id: null, email: null } }));

      expect(rowFor(fixture, PRIMARY_EMAIL.email).isMeetingInvite).toBe(true);
      expect(rowFor(fixture, ALT_EMAIL.email).isMeetingInvite).toBe(false);
      expect(menuLabelsFor(fixture, PRIMARY_EMAIL.email)).not.toContain('Use for Meeting Invitations');
      expect(menuLabelsFor(fixture, ALT_EMAIL.email)).toContain('Use for Meeting Invitations');
    });

    it('badges the primary row when the override is pinned to the primary address', async () => {
      const fixture = await setup(makeUserServiceMock({ invite: { email_id: 'id-1', email: ' PRIMARY@example.com ' } }));

      expect(rowFor(fixture, PRIMARY_EMAIL.email).isMeetingInvite).toBe(true);
      expect(menuLabelsFor(fixture, PRIMARY_EMAIL.email)).not.toContain('Use for Meeting Invitations');
      expect(fixture.componentInstance.orphanedInviteEmail()).toBeNull();
    });

    it('moves the badge to the overriding row and offers the primary the same invite action', async () => {
      const fixture = await setup(makeUserServiceMock({ invite: { email_id: 'id-1', email: ALT_EMAIL.email } }));

      expect(rowFor(fixture, PRIMARY_EMAIL.email).isMeetingInvite).toBe(false);
      expect(rowFor(fixture, ALT_EMAIL.email).isMeetingInvite).toBe(true);
      expect(menuLabelsFor(fixture, PRIMARY_EMAIL.email)).toContain('Use for Meeting Invitations');
      expect(menuLabelsFor(fixture, PRIMARY_EMAIL.email)).not.toContain('Reset to Default (Primary Email)');
    });

    it('treats re-picking the primary as a no-op while it already receives invitations', async () => {
      const userServiceMock = makeUserServiceMock({ invite: { email_id: 'id-1', email: PRIMARY_EMAIL.email } });
      const fixture = await setup(userServiceMock);

      fixture.componentInstance.setMeetingInvite(PRIMARY_EMAIL);

      expect(userServiceMock['setMeetingInviteEmail']).not.toHaveBeenCalled();
    });

    it('badges no row and flags the load failure when the invite lookup failed', async () => {
      const fixture = await setup(makeUserServiceMock({ invite: 'error' }));

      expect(fixture.componentInstance.meetingInviteLoadFailed()).toBe(true);
      expect(fixture.componentInstance.emailsWithMetadata().some((e) => e.isMeetingInvite)).toBe(false);
    });

    it('lets the primary row pin itself after a failed lookup instead of silently no-oping', async () => {
      const userServiceMock = makeUserServiceMock({ invite: 'error' });
      const fixture = await setup(userServiceMock);

      expect(menuLabelsFor(fixture, PRIMARY_EMAIL.email)).toContain('Use for Meeting Invitations');
      fixture.componentInstance.setMeetingInvite(PRIMARY_EMAIL);

      expect(userServiceMock['setMeetingInviteEmail']).toHaveBeenCalledWith(PRIMARY_EMAIL.email);
    });

    it('surfaces an override that matches none of the listed addresses', async () => {
      const fixture = await setup(makeUserServiceMock({ invite: { email_id: 'id-1', email: 'unlisted@example.com' } }));

      expect(fixture.componentInstance.orphanedInviteEmail()).toBe('unlisted@example.com');
      expect(fixture.componentInstance.emailsWithMetadata().some((e) => e.isMeetingInvite)).toBe(false);
      expect(menuLabelsFor(fixture, PRIMARY_EMAIL.email)).toContain('Use for Meeting Invitations');
    });
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
    // This 503 carries no advisory code, so its body is dropped in favour of the caller's fallback:
    // `extractErrorMessage` skips 5xx bodies because they are overwhelmingly the envelope's "Internal
    // server error" or a Go-service string forwarded verbatim, neither of which names the action that
    // failed. The test below is the one exception.
    expect(messageServiceMock.add).toHaveBeenCalledWith(expect.objectContaining({ severity: 'error', detail: 'Failed to update meeting invitation email' }));
  });

  // The other end of the advisory code. `profile.controller.ts` mints this 503 with copy telling the
  // organizer to wait and retry — actionable, and true of nothing else the fallback could say. Without
  // the code the blanket 5xx skip traded it for "Failed to update meeting invitation email", which reads
  // as a permanent failure of a write that will succeed on its own in a minute.
  it('shows the retry guidance a 503 wrote for the organizer, when it says so', async () => {
    const guidance = 'This email was added recently and is not ready to use yet. Please try again in a few minutes.';
    const messageServiceMock = { add: vi.fn() };
    const userServiceMock = makeUserServiceMock({
      invite: { email_id: null, email: null },
      setMeetingInviteEmail: () => throwError(() => new HttpErrorResponse({ status: 503, error: { error: guidance, code: ERROR_CODES.SERVICE_ADVISORY } })),
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
    expect(messageServiceMock.add).toHaveBeenCalledWith(expect.objectContaining({ severity: 'error', detail: guidance }));
  });

  // A primary change is blocked when the invite email couldn't be pinned first (#3983); the reason
  // must reach the user rather than a generic failure, for both the retryable and the rejected case.
  it.each([
    ['a retryable 503 advisory', 503, ERROR_CODES.SERVICE_ADVISORY, "Your primary email wasn't changed. Please try again in a few minutes."],
    [
      'a rejected-pin 400',
      400,
      ERROR_CODES.VALIDATION_ERROR,
      "Your primary email wasn't changed. Choose a different address for meeting invitations in Settings.",
    ],
  ])('shows why a primary change was blocked by %s', async (_label, status, code, guidance) => {
    const userServiceMock = makeUserServiceMock();
    userServiceMock['setPrimaryEmail'] = vi.fn(() =>
      throwError(
        () =>
          new HttpErrorResponse({ status, error: { error: guidance, code, errors: [{ field: 'email', message: guidance, code: 'FIELD_VALIDATION_ERROR' }] } })
      )
    );
    const fixture = await setup(userServiceMock);

    fixture.componentInstance.setPrimary(ALT_EMAIL);

    expect(TestBed.inject(MessageService).add).toHaveBeenCalledWith(expect.objectContaining({ severity: 'error', detail: guidance }));
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

  it('shows the fallback message, not raw transport text, when the delete-email failure carries no body (cursor bugbot, PR #2325)', async () => {
    const messageServiceMock = { add: vi.fn() };
    const rejectIdentity = vi.fn(() => throwError(() => new HttpErrorResponse({ status: 409 })));
    const userServiceMock = makeUserServiceMock({ invite: { email_id: null, email: null }, rejectIdentity });
    const confirmationServiceMock: Partial<ConfirmationService> = {
      confirm: vi.fn((params) => params.accept?.()),
    };
    TestBed.configureTestingModule({
      imports: [AccountSettingsComponent],
      providers: [
        { provide: PLATFORM_ID, useValue: 'browser' },
        { provide: ActivatedRoute, useValue: { snapshot: { data: {} }, fragment: of(null) } },
        { provide: UserService, useValue: userServiceMock },
        { provide: ConfirmationService, useValue: confirmationServiceMock },
        { provide: MessageService, useValue: messageServiceMock },
        { provide: DialogService, useValue: { open: vi.fn() } },
      ],
    });
    TestBed.overrideComponent(AccountSettingsComponent, { set: { template: '', imports: [], providers: [] } });
    const fixture = TestBed.createComponent(AccountSettingsComponent);
    fixture.detectChanges();
    await fixture.whenStable();

    fixture.componentInstance.deleteEmail(ALT_EMAIL);
    await fixture.whenStable();

    expect(messageServiceMock.add).toHaveBeenCalledWith(expect.objectContaining({ severity: 'error', detail: 'Failed to delete email address' }));
  });
});

describe('AccountSettingsComponent — email verification support', () => {
  it('makes support reachable in the OTP step after a generic successful send', async () => {
    const userServiceMock = {
      impersonating: signal(false),
      getUserEmails: vi.fn(() => of<EmailManagementData>({ primary_email: 'primary@example.test', alternate_emails: [] })),
      getMeetingInviteEmail: vi.fn(() => of({ email_id: null, email: null })),
      getDeveloperTokenInfo: vi.fn(() => of({ token: '' })),
      sendEmailVerificationCode: vi.fn(() => of<SendEmailVerificationResponse>({ success: true, message: EMAIL_VERIFICATION_SENT_MESSAGE })),
    };

    TestBed.configureTestingModule({
      imports: [AccountSettingsComponent],
      providers: [
        // Skip unrelated browser scroll observers while rendering the real form and template.
        { provide: PLATFORM_ID, useValue: 'server' },
        { provide: ActivatedRoute, useValue: { snapshot: { data: {} }, fragment: of(null) } },
        { provide: UserService, useValue: userServiceMock },
        { provide: FeatureFlagService, useValue: { getBooleanFlag: () => signal(false) } },
        { provide: IntercomService, useValue: { openMessenger: vi.fn() } },
      ],
    });

    const fixture = TestBed.createComponent(AccountSettingsComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    const root = fixture.nativeElement as HTMLElement;

    expect(root.querySelector('[data-testid="otp-support-hint"]')).toBeNull();

    const emailInput = root.querySelector<HTMLInputElement>('[data-testid="add-email-input"] input')!;
    emailInput.value = 'new-address@example.test';
    emailInput.dispatchEvent(new Event('input', { bubbles: true }));
    fixture.detectChanges();
    expect(root.querySelector<HTMLButtonElement>('[data-testid="send-code-button"] button')?.disabled).toBe(false);

    root.querySelector<HTMLFormElement>('[data-testid="add-email-form"]')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    fixture.detectChanges();
    await fixture.whenStable();

    const otpStep = root.querySelector('[data-testid="otp-step"]')!;
    expect(otpStep.querySelector('[data-testid="otp-input"] input')).not.toBeNull();
    const supportButton = otpStep.querySelector<HTMLButtonElement>('[data-testid="otp-support-hint"] [data-testid="otp-support-button"]');
    expect(supportButton?.disabled).toBe(false);
    expect(root.querySelector('[data-testid="add-email-form"]')).toBeNull();
  });
});

describe('AccountSettingsComponent — resend escalation (#4695)', () => {
  const normalizedText = (element: Element | null): string => (element?.textContent ?? '').replace(/\s+/g, ' ').trim();

  async function setup(
    send: () => Observable<SendEmailVerificationResponse> = () => of<SendEmailVerificationResponse>({ success: true, message: EMAIL_VERIFICATION_SENT_MESSAGE })
  ) {
    const userServiceMock = {
      impersonating: signal(false),
      getUserEmails: vi.fn(() => of<EmailManagementData>({ primary_email: 'primary@example.test', alternate_emails: [] })),
      getMeetingInviteEmail: vi.fn(() => of({ email_id: null, email: null })),
      getDeveloperTokenInfo: vi.fn(() => of({ token: '' })),
      sendEmailVerificationCode: vi.fn(send),
    };

    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [AccountSettingsComponent],
      providers: [
        { provide: PLATFORM_ID, useValue: 'server' },
        { provide: ActivatedRoute, useValue: { snapshot: { data: {} }, fragment: of(null) } },
        { provide: UserService, useValue: userServiceMock },
        { provide: FeatureFlagService, useValue: { getBooleanFlag: () => signal(false) } },
        { provide: IntercomService, useValue: { openMessenger: vi.fn() } },
      ],
    });

    const fixture = TestBed.createComponent(AccountSettingsComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    const component = fixture.componentInstance;
    component.addEmailForm.setValue({ email: 'new-address@example.test' });
    component.sendVerificationCode();
    fixture.detectChanges();

    return { component, userServiceMock, fixture, root: fixture.nativeElement as HTMLElement };
  }

  afterEach(() => {
    vi.useRealTimers();
  });

  it('words the complete email flow conditionally before and after a generic successful send', async () => {
    const response$ = new Subject<SendEmailVerificationResponse>();
    const { component, fixture, root } = await setup(() => response$);

    expect(component.otpStep()).toBe(false);
    expect(normalizedText(root)).toContain("If this address can be added to your account, we'll send a 6-digit verification code to it.");
    expect(normalizedText(root)).not.toContain('A 6-digit verification code will be sent to the new address');

    response$.next({ success: true, message: EMAIL_VERIFICATION_SENT_MESSAGE });
    response$.complete();
    fixture.detectChanges();

    expect(component.otpStep()).toBe(true);
    const otpStep = root.querySelector('[data-testid="otp-step"]');
    expect(normalizedText(otpStep)).toContain('If this address can be added to your account, a 6-digit code has been sent to new-address@example.test');
    expect(normalizedText(otpStep)).not.toContain("we'll send a 6-digit code");
    expect(normalizedText(root.querySelector('[data-testid="otp-support-hint"]'))).toContain(EMAIL_CODE_NOT_RECEIVED_HINT);
    expect(root.querySelector('[data-testid="resend-support-callout"]')).toBeNull();
  });

  it('replaces Resend with Contact support after the first successful resend', async () => {
    vi.useFakeTimers();
    const { component, fixture, root } = await setup();
    expect(component.showResendSupport()).toBe(false);

    vi.advanceTimersByTime(60_000);
    component.sendVerificationCode();
    fixture.detectChanges();

    expect(component.resendCount()).toBe(1);
    expect(component.showResendSupport()).toBe(true);
    const callout = root.querySelector('[data-testid="resend-support-callout"]');
    expect(callout).not.toBeNull();
    expect(callout?.querySelector('[data-testid="resend-support-button"]')?.hasAttribute('lfxOpenIntercom')).toBe(true);
    expect(root.querySelector('button[data-testid="resend-code-link"]')).toBeNull();
  });

  it('does not count a failed resend', async () => {
    const { component, userServiceMock } = await setup();
    userServiceMock.sendEmailVerificationCode.mockReturnValue(of<SendEmailVerificationResponse>({ success: false, message: 'nope' }));

    component.sendVerificationCode();

    expect(component.resendCount()).toBe(0);
  });

  it('resets the count on cancel so a different address starts fresh', async () => {
    const { component, fixture, root } = await setup();
    component.sendVerificationCode();
    expect(component.resendCount()).toBe(1);

    component.cancelOtpStep();
    fixture.detectChanges();
    expect(component.resendCount()).toBe(0);
    expect(root.querySelector('[data-testid="otp-step"]')).toBeNull();

    component.addEmailForm.setValue({ email: 'another@example.test' });
    component.sendVerificationCode();
    expect(component.resendCount()).toBe(0);
  });
});

/**
 * Guards #4253: auth-service reports an address already connected to the caller as a token-free
 * success, which the BFF returns as `status: 'already_connected'`. The settings form must say so
 * instead of claiming a new address was added, while keeping its reset/refresh sequence.
 */
describe('AccountSettingsComponent — verify and link outcome (#4253)', () => {
  async function setup(verify: () => Observable<VerifyAndLinkEmailResponse>) {
    const add = vi.fn();
    const userServiceMock = {
      impersonating: signal(true), // skips the developer-token fetch — irrelevant to this suite
      getUserEmails: vi.fn(() => of<EmailManagementData>({ primary_email: 'primary@example.test', alternate_emails: [] })),
      getMeetingInviteEmail: vi.fn(() => of({ email_id: null, email: null })),
      verifyAndLinkEmail: vi.fn(verify),
    };

    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [AccountSettingsComponent],
      providers: [
        // Server platform: the authorization redirect is a no-op, so the 403 branch can be observed.
        { provide: PLATFORM_ID, useValue: 'server' },
        { provide: ActivatedRoute, useValue: { snapshot: { data: {} }, fragment: of(null) } },
        { provide: UserService, useValue: userServiceMock },
        { provide: ConfirmationService, useValue: {} },
        { provide: MessageService, useValue: { add } },
        { provide: DialogService, useValue: { open: vi.fn() } },
      ],
    });
    // providers: [] — see the note in the first suite.
    TestBed.overrideComponent(AccountSettingsComponent, { set: { template: '', imports: [], providers: [] } });

    const fixture = TestBed.createComponent(AccountSettingsComponent);
    fixture.detectChanges();
    await fixture.whenStable();

    const component = fixture.componentInstance;
    component.otpStep.set(true);
    component.pendingEmail.set('owned@example.test');
    component.otpForm.setValue({ otp: '123456' });

    return { component, add, userServiceMock };
  }

  it('confirms an already-connected address without claiming it was added, then resets and refreshes', async () => {
    const { component, add, userServiceMock } = await setup(() =>
      of<VerifyAndLinkEmailResponse>({ success: true, status: 'already_connected', message: EMAIL_ALREADY_CONNECTED_MESSAGE })
    );
    const loadsBefore = userServiceMock.getUserEmails.mock.calls.length;

    component.verifyAndLink();

    expect(userServiceMock.verifyAndLinkEmail).toHaveBeenCalledExactlyOnceWith('owned@example.test', '123456');
    expect(add).toHaveBeenCalledExactlyOnceWith({ severity: 'success', summary: 'Success', detail: EMAIL_ALREADY_CONNECTED_MESSAGE });
    expect(component.otpStep()).toBe(false);
    expect(component.pendingEmail()).toBe('');
    expect(component.otpForm.value.otp).toBeNull();
    expect(userServiceMock.getUserEmails.mock.calls.length).toBe(loadsBefore + 1);
    expect(component.verifyingOtp()).toBe(false);
  });

  it('keeps the new-address copy for an ordinary link', async () => {
    const { component, add, userServiceMock } = await setup(() =>
      of<VerifyAndLinkEmailResponse>({ success: true, message: 'Email identity verified and linked successfully' })
    );
    const loadsBefore = userServiceMock.getUserEmails.mock.calls.length;

    component.verifyAndLink();

    expect(add).toHaveBeenCalledExactlyOnceWith({ severity: 'success', summary: 'Success', detail: 'Email address added successfully' });
    expect(component.otpStep()).toBe(false);
    expect(userServiceMock.getUserEmails.mock.calls.length).toBe(loadsBefore + 1);
  });

  it('hands off to authorization without a toast or reset when the management token is missing', async () => {
    const { component, add, userServiceMock } = await setup(() =>
      throwError(
        () =>
          new HttpErrorResponse({
            status: 403,
            error: { success: false, error: 'management_token_required', authorize_url: '/api/profile/auth/start?returnTo=%2Fprofile%2Femails' },
          })
      )
    );
    const loadsBefore = userServiceMock.getUserEmails.mock.calls.length;

    component.verifyAndLink();

    expect(add).not.toHaveBeenCalled();
    expect(component.otpStep()).toBe(true);
    expect(component.pendingEmail()).toBe('owned@example.test');
    expect(userServiceMock.getUserEmails.mock.calls.length).toBe(loadsBefore);
    expect(component.verifyingOtp()).toBe(false);
  });

  it('keeps the OTP step open with the server message on a failed verification so the user can retry', async () => {
    const { component, add } = await setup(() =>
      throwError(
        () =>
          new HttpErrorResponse({
            status: 400,
            error: { success: false, error: 'verification_failed', message: 'Verification failed. Please try again or request a new code.' },
          })
      )
    );

    component.verifyAndLink();

    expect(add).toHaveBeenCalledExactlyOnceWith({
      severity: 'error',
      summary: 'Error',
      detail: 'Verification failed. Please try again or request a new code.',
    });
    expect(component.otpStep()).toBe(true);
    expect(component.verifyingOtp()).toBe(false);
  });
});
