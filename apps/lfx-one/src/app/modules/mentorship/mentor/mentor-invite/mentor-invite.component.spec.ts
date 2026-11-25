// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpErrorResponse } from '@angular/common/http';
import { PLATFORM_ID } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { ActivatedRoute, convertToParamMap, ParamMap, provideRouter } from '@angular/router';
import { MentorshipMentorService } from '@services/mentorship-mentor.service';
import { BehaviorSubject, Observable, of, Subject, throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { MentorInviteComponent } from './mentor-invite.component';

describe('MentorInviteComponent', () => {
  const token = 'eyJwcm9ncmFtX2lkIjoicDEifQ.c2lnbmF0dXJl';
  const programId = 'c0e2e378-0000-4000-8000-0000000000aa';

  let fixture: ComponentFixture<MentorInviteComponent>;
  let respondToMentorInvite: ReturnType<typeof vi.fn>;
  let checkMentorProfile: ReturnType<typeof vi.fn>;
  let getMentorInvite: ReturnType<typeof vi.fn>;

  const build = (
    options: {
      link?: string | null;
      respond?: Observable<void>;
      queryParamMap?: Observable<ParamMap>;
      hasProfile?: boolean;
      platform?: string;
      invite?: Observable<{ programId: string; programName: string }>;
      profile?: Observable<{ hasProfile: boolean }>;
    } = {}
  ): void => {
    const {
      link = token,
      respond = of(undefined),
      queryParamMap = of(convertToParamMap(link === null ? {} : { token: link })),
      hasProfile = true,
      platform = 'browser',
      invite = of({ programId: '', programName: '' }),
      profile = of({ hasProfile }),
    } = options;
    respondToMentorInvite = vi.fn(() => respond);
    checkMentorProfile = vi.fn(() => profile);
    getMentorInvite = vi.fn(() => invite);

    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [MentorInviteComponent],
      providers: [
        provideNoopAnimations(),
        provideRouter([]),
        { provide: MentorshipMentorService, useValue: { respondToMentorInvite, checkMentorProfile, getMentorInvite } },
        { provide: ActivatedRoute, useValue: { queryParamMap } },
        { provide: PLATFORM_ID, useValue: platform },
      ],
    });

    fixture = TestBed.createComponent(MentorInviteComponent);
    fixture.detectChanges();
  };

  const byTestId = (id: string): HTMLElement | null => (fixture.nativeElement as HTMLElement).querySelector<HTMLElement>(`[data-testid="${id}"]`);
  const click = (id: string): void => {
    byTestId(id)?.querySelector<HTMLButtonElement>('button')?.click();
    fixture.detectChanges();
  };
  const httpError = (status: number): Observable<never> => throwError(() => new HttpErrorResponse({ status }));

  it('asks before answering, and answers nothing when the link is opened', () => {
    build();

    expect(byTestId('mentorship-mentor-invite-title')?.textContent).toContain("You've been invited to be a mentor");
    expect(respondToMentorInvite).not.toHaveBeenCalled();
  });

  it('names the invited program once the browser has read it, through to the answer', () => {
    build({ invite: of({ programId, programName: 'Open Source Mentorship' }) });

    expect(getMentorInvite).toHaveBeenCalledWith(token);
    // The name is bold in the description; the title stays the same for every program.
    expect(byTestId('mentorship-mentor-invite-description')?.querySelector('strong')?.textContent).toBe('Open Source Mentorship');
    expect(byTestId('mentorship-mentor-invite-title')?.textContent?.trim()).toBe("You've been invited to be a mentor");
    expect(byTestId('mentorship-mentor-invite-description')?.textContent).toContain('invited you to join Open Source Mentorship as a mentor');

    click('mentorship-mentor-invite-accept-button');
    const accepted = byTestId('mentorship-mentor-invite-accepted');
    expect(byTestId('mentorship-mentor-invite-accepted-message')?.textContent?.trim()).toBe("You're now a mentor on Open Source Mentorship.");
    expect(accepted?.querySelector('strong')?.textContent).toBe('Open Source Mentorship');
    expect(accepted?.querySelector('i')?.classList).toContain('!text-emerald-600');
  });

  it("links to the program's public page in a new tab", () => {
    build({ invite: of({ programId, programName: 'Open Source Mentorship' }) });

    const link = byTestId('mentorship-mentor-invite-view-program') as HTMLAnchorElement | null;
    expect(link?.textContent).toContain('View program');
    expect(link?.getAttribute('href')).toMatch(new RegExp(`/programs/${programId}$`));
    expect(link?.getAttribute('target')).toBe('_blank');
    expect(link?.getAttribute('rel')).toBe('noopener noreferrer');
  });

  it.each([
    ['the read fails', httpError(503)],
    ['the program id is not a UUID', of({ programId: 'prog-1', programName: 'Open Source Mentorship' })],
  ])('shows no View program link when %s', (_label, invite) => {
    build({ invite });

    expect(byTestId('mentorship-mentor-invite-view-program')).toBeNull();
  });

  it('names the program on a decline too', () => {
    build({ invite: of({ programId, programName: 'Open Source Mentorship' }) });

    click('mentorship-mentor-invite-decline-button');
    expect(byTestId('mentorship-mentor-invite-declined-message')?.textContent?.trim()).toBe("We've let the admins of Open Source Mentorship know.");
    expect(byTestId('mentorship-mentor-invite-declined')?.querySelector('strong')?.textContent).toBe('Open Source Mentorship');
  });

  it.each([
    ['the read fails', httpError(403)],
    ['the program has no name', of({ programId: '', programName: '' })],
  ])('keeps the generic copy when %s, and still answers', (_label, invite) => {
    build({ invite });

    expect(byTestId('mentorship-mentor-invite-program-name')).toBeNull();
    expect(byTestId('mentorship-mentor-invite-description')?.textContent).toContain('The invitation email names the program.');
    expect(byTestId('mentorship-mentor-invite-confirm')).not.toBeNull();

    click('mentorship-mentor-invite-accept-button');
    expect(byTestId('mentorship-mentor-invite-accepted')?.textContent).toContain("You're now a mentor on the program.");
  });

  it('does not read the program on the server, or for an unusable link', () => {
    build({ platform: 'server' });
    expect(getMentorInvite).not.toHaveBeenCalled();

    build({ link: 'no-signature' });
    expect(getMentorInvite).not.toHaveBeenCalled();
  });

  it('points someone with no mentor profile to create one, and disables Accept and Decline', () => {
    build({ hasProfile: false });

    const hint = byTestId('mentorship-mentor-invite-profile-hint');
    expect(hint?.textContent).toContain('You need a mentor profile to answer this invitation.');
    expect(hint?.querySelector('a')?.getAttribute('href')).toBe('/mentorship/mentor');
    expect(byTestId('mentorship-mentor-invite-accept-button')?.querySelector('button')?.disabled).toBe(true);
    expect(byTestId('mentorship-mentor-invite-decline-button')?.querySelector('button')?.disabled).toBe(true);

    // The handler refuses too, so nothing but a confirmed profile sends an answer.
    (fixture.componentInstance as unknown as { onRespond(decision: string): void }).onRespond('accept');
    expect(respondToMentorInvite).not.toHaveBeenCalled();
  });

  it('offers Try again when the profile check fails, without claiming there is no profile', () => {
    build({ profile: httpError(503) });

    expect(byTestId('mentorship-mentor-invite-profile-check-failed')?.textContent).toContain("We couldn't check your mentor profile.");
    expect(byTestId('mentorship-mentor-invite-profile-hint')).toBeNull();
    expect(byTestId('mentorship-mentor-invite-accept-button')?.querySelector('button')?.disabled).toBe(true);

    checkMentorProfile.mockReturnValueOnce(of({ hasProfile: true }));
    byTestId('mentorship-mentor-invite-profile-check-retry')?.click();
    fixture.detectChanges();

    expect(checkMentorProfile).toHaveBeenCalledTimes(2);
    expect(byTestId('mentorship-mentor-invite-profile-check-failed')).toBeNull();
    expect(byTestId('mentorship-mentor-invite-accept-button')?.querySelector('button')?.disabled).toBe(false);
  });

  it('keeps Accept and Decline disabled until the profile check answers', () => {
    const answer = new Subject<{ hasProfile: boolean }>();
    build({ profile: answer });

    expect(byTestId('mentorship-mentor-invite-accept-button')?.querySelector('button')?.disabled).toBe(true);
    expect(byTestId('mentorship-mentor-invite-profile-hint')).toBeNull();

    answer.next({ hasProfile: true });
    fixture.detectChanges();
    expect(byTestId('mentorship-mentor-invite-accept-button')?.querySelector('button')?.disabled).toBe(false);
  });

  it('neither reads the profile nor hints on the server, whose read goes out without the session cookie, and leaves the answer to the browser', () => {
    build({ hasProfile: false, platform: 'server' });

    expect(checkMentorProfile).not.toHaveBeenCalled();
    expect(byTestId('mentorship-mentor-invite-profile-hint')).toBeNull();
    expect(byTestId('mentorship-mentor-invite-accept-button')?.querySelector('button')?.disabled).toBe(true);
  });

  it('shows no profile hint to someone who has a mentor profile', () => {
    build();

    expect(byTestId('mentorship-mentor-invite-profile-hint')).toBeNull();
  });

  it.each([
    ['accept', 'mentorship-mentor-invite-accept-button', 'mentorship-mentor-invite-accepted', 'Invitation accepted'],
    ['decline', 'mentorship-mentor-invite-decline-button', 'mentorship-mentor-invite-declined', 'Invitation declined'],
  ])('sends %s with the token and shows the outcome', (decision, button, outcome, text) => {
    build();

    click(button);

    expect(respondToMentorInvite).toHaveBeenCalledWith(token, decision);
    expect(byTestId(outcome)?.textContent).toContain(text);
  });

  it('answers once while the answer is in flight', () => {
    build({ respond: new Subject<void>() });

    // Call the handler directly: the buttons are disabled in flight, so a second click would never reach the guard.
    const component = fixture.componentInstance as unknown as { onRespond(decision: string): void };
    component.onRespond('accept');
    component.onRespond('decline');
    fixture.detectChanges();

    expect(respondToMentorInvite).toHaveBeenCalledTimes(1);
    expect(byTestId('mentorship-mentor-invite-accept-button')?.getAttribute('data-loading')).toBe('true');
  });

  it('keeps the answer in flight when the page is left', () => {
    const pending = new Subject<void>();
    build({ respond: pending });

    click('mentorship-mentor-invite-accept-button');
    fixture.destroy();

    expect(pending.observed).toBe(true);
  });

  it.each([
    ['no token', null],
    ['a blank token', '  '],
    ['a token without a signature', 'eyJwcm9ncmFtX2lkIjoicDEifQ'],
    ['a token with other characters', 'abc.d/ef'],
  ])('treats a link with %s as invalid without calling the API', (_label, link) => {
    build({ link });

    expect(respondToMentorInvite).not.toHaveBeenCalled();
    expect(byTestId('mentorship-mentor-invite-invalid-link')).not.toBeNull();
  });

  it.each([
    [400, 'mentorship-mentor-invite-invalid-link'],
    [403, 'mentorship-mentor-invite-forbidden'],
    [409, 'mentorship-mentor-invite-invalid-link'],
    [502, 'mentorship-mentor-invite-error'],
  ])('maps a %i to its own state', (status, testId) => {
    build({ respond: httpError(status) });

    click('mentorship-mentor-invite-accept-button');

    expect(byTestId(testId)).not.toBeNull();
  });

  it('tells an impersonating admin the page is read-only rather than blaming the account', () => {
    build({ respond: throwError(() => new HttpErrorResponse({ status: 403, error: { code: 'IMPERSONATION_READ_ONLY' } })) });

    click('mentorship-mentor-invite-accept-button');

    expect(byTestId('mentorship-mentor-invite-read-only')?.textContent).toContain('viewing as another user');
    expect(byTestId('mentorship-mentor-invite-forbidden')).toBeNull();
  });

  it('returns to the choice when Try again follows a failure, and answers again', () => {
    build({ respond: httpError(502) });

    click('mentorship-mentor-invite-accept-button');
    click('mentorship-mentor-invite-error');

    expect(byTestId('mentorship-mentor-invite-confirm')).not.toBeNull();

    respondToMentorInvite.mockReturnValueOnce(of(undefined));
    click('mentorship-mentor-invite-accept-button');

    expect(respondToMentorInvite).toHaveBeenCalledTimes(2);
    expect(byTestId('mentorship-mentor-invite-accepted')).not.toBeNull();
  });

  it('asks about a new link, without showing the answer to the previous one', () => {
    const query = new BehaviorSubject(convertToParamMap({ token }));
    const pending = new Subject<void>();
    build({ queryParamMap: query, respond: pending });

    click('mentorship-mentor-invite-accept-button');
    query.next(convertToParamMap({ token: 'b3RoZXI.c2ln' }));
    pending.next();
    pending.complete();
    fixture.detectChanges();

    expect(byTestId('mentorship-mentor-invite-accepted')).toBeNull();
    expect(byTestId('mentorship-mentor-invite-confirm')).not.toBeNull();
  });
});
