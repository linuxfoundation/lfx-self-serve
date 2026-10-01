// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpErrorResponse } from '@angular/common/http';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { ActivatedRoute, convertToParamMap, ParamMap, provideRouter } from '@angular/router';
import { MentorshipMentorService } from '@services/mentorship-mentor.service';
import { BehaviorSubject, Observable, of, Subject, throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { MentorInviteComponent } from './mentor-invite.component';

describe('MentorInviteComponent', () => {
  const token = 'eyJwcm9ncmFtX2lkIjoicDEifQ.c2lnbmF0dXJl';

  let fixture: ComponentFixture<MentorInviteComponent>;
  let respondToMentorInvite: ReturnType<typeof vi.fn>;

  const build = (options: { link?: string | null; respond?: Observable<void>; queryParamMap?: Observable<ParamMap> } = {}): void => {
    const { link = token, respond = of(undefined), queryParamMap = of(convertToParamMap(link === null ? {} : { token: link })) } = options;
    respondToMentorInvite = vi.fn(() => respond);

    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [MentorInviteComponent],
      providers: [
        provideNoopAnimations(),
        provideRouter([]),
        { provide: MentorshipMentorService, useValue: { respondToMentorInvite } },
        { provide: ActivatedRoute, useValue: { queryParamMap } },
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

    expect(byTestId('mentorship-mentor-invite-title')?.textContent).toContain("You've been invited to mentor");
    expect(respondToMentorInvite).not.toHaveBeenCalled();
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
