// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpErrorResponse } from '@angular/common/http';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import {
  MENTORSHIP_ADMIN_MENTOR_CANDIDATES_EMAIL_INVITE_MESSAGE,
  MENTORSHIP_ADMIN_MENTOR_CANDIDATES_FAILED_MESSAGE,
  MENTORSHIP_ADMIN_MENTOR_CANDIDATES_NO_ACCOUNT_MESSAGE,
  MENTORSHIP_ADMIN_MENTOR_CANDIDATES_NO_MATCH_MESSAGE,
  MENTORSHIP_ADMIN_MENTOR_CANDIDATES_TOO_LONG_MESSAGE,
  MENTORSHIP_ADMIN_MENTOR_CANDIDATES_UNAVAILABLE_MESSAGE,
  MENTORSHIP_ADMIN_MENTOR_EMAIL_INVITE_STEPS,
  MENTORSHIP_ADMIN_MENTOR_EMAIL_INVITE_STEPS_INTRO,
  MENTORSHIP_ADMIN_MENTOR_INVITE_CONFLICT_MESSAGE,
  MENTORSHIP_ADMIN_MENTOR_INVITE_FAILED_MESSAGE,
  MENTORSHIP_ADMIN_MENTOR_INVITE_PROMPT,
  MENTORSHIP_ADMIN_MENTOR_INVITE_UNPUBLISHED_MESSAGE,
  MENTORSHIP_ADMIN_MENTOR_INVITED_BY_EMAIL_MESSAGE,
  MENTORSHIP_ADMIN_MENTOR_INVITED_MESSAGE,
  MENTORSHIP_IMPERSONATION_READ_ONLY_ERROR_CODE,
} from '@lfx-one/shared/constants';
import { MentorshipAdminMentorCandidatesResponse, MentorshipAdminMentorInviteRequest } from '@lfx-one/shared/interfaces';
import { MentorshipAdminService } from '@services/mentorship-admin.service';
import { MessageService, ToastMessageOptions } from 'primeng/api';
import { DynamicDialogConfig, DynamicDialogRef } from 'primeng/dynamicdialog';
import { Observable, of, Subject, throwError } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { InviteMentorDialogComponent } from './invite-mentor-dialog.component';

describe('InviteMentorDialogComponent', () => {
  let fixture: ComponentFixture<InviteMentorDialogComponent>;
  let close: ReturnType<typeof vi.fn>;
  let toast: ReturnType<typeof vi.fn<(message: ToastMessageOptions) => void>>;
  let getMentorCandidates: ReturnType<typeof vi.fn<(programId: string, search: string) => Observable<MentorshipAdminMentorCandidatesResponse>>>;
  let inviteProgramMentor: ReturnType<typeof vi.fn<(programId: string, body: MentorshipAdminMentorInviteRequest) => Observable<void>>>;
  let onListChanged: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers();
    close = vi.fn();
    toast = vi.fn();
    getMentorCandidates = vi.fn().mockReturnValue(
      of({
        data: [
          { lfid: 'priya', name: 'Priya Natarajan', avatarUrl: 'https://cdn.example.com/priya.png' },
          { lfid: 'dsouza', name: 'dsouza' },
        ],
      })
    );
    inviteProgramMentor = vi.fn().mockReturnValue(of(undefined));
    onListChanged = vi.fn();

    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [InviteMentorDialogComponent],
      providers: [
        provideNoopAnimations(),
        { provide: MessageService, useValue: { add: toast } },
        { provide: DynamicDialogRef, useValue: { close } },
        { provide: DynamicDialogConfig, useValue: { data: { programId: 'prog_1', onListChanged } } },
        { provide: MentorshipAdminService, useValue: { getMentorCandidates, inviteProgramMentor } },
      ],
    });

    fixture = TestBed.createComponent(InviteMentorDialogComponent);
    fixture.detectChanges();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const component = () => fixture.componentInstance;
  const element = (): HTMLElement => fixture.nativeElement as HTMLElement;
  const byTestId = (id: string): HTMLElement | null => element().querySelector<HTMLElement>(`[data-testid="${id}"]`);
  const sendButton = (): HTMLButtonElement | null => byTestId('mentorship-mentors-invite-send')?.querySelector('button') ?? null;
  /** Types into the search and lets the debounce pass, so the search is answered. */
  const type = (text: string): void => {
    component()['form'].controls.search.setValue(text);
    vi.advanceTimersByTime(300);
    fixture.detectChanges();
  };
  const pick = (lfid: string): void => {
    byTestId(`mentorship-mentors-candidate-${lfid}`)?.click();
    fixture.detectChanges();
  };

  it('starts with the prompt and nothing to send', () => {
    expect(element().textContent).toContain('Search LF users, or enter an email to invite someone new.');
    expect(byTestId('mentorship-mentors-invite-prompt')?.textContent).toContain(MENTORSHIP_ADMIN_MENTOR_INVITE_PROMPT);
    expect(sendButton()?.disabled).toBe(true);
    expect(sendButton()?.textContent).toContain('Send invite');
  });

  describe('search', () => {
    it('shows that it is searching until typing pauses, then asks for the trimmed search of this program', () => {
      component()['form'].controls.search.setValue('  priya ');
      fixture.detectChanges();
      expect(byTestId('mentorship-mentors-invite-searching')).not.toBeNull();
      expect(getMentorCandidates).not.toHaveBeenCalled();

      vi.advanceTimersByTime(300);
      fixture.detectChanges();

      expect(getMentorCandidates).toHaveBeenCalledWith('prog_1', 'priya');
      expect(byTestId('mentorship-mentors-invite-searching')).toBeNull();
    });

    it('lists each candidate by name and LFID, never an email', () => {
      type('priya');

      const option = byTestId('mentorship-mentors-candidate-priya');
      expect(option?.textContent).toContain('Priya Natarajan');
      expect(option?.textContent).toContain('priya');
      expect(component()['candidateOptions']()[0]).toMatchObject({ lfid: 'priya', initials: 'PN' });
      expect(JSON.stringify(component()['candidateOptions']())).not.toContain('@');
    });

    it.each([' p ', '😀'])('keeps the prompt and asks nothing for %j, below two characters as upstream counts them', (text) => {
      type(text);

      expect(getMentorCandidates).not.toHaveBeenCalled();
      expect(byTestId('mentorship-mentors-invite-prompt')).not.toBeNull();
    });

    it('does not send a search over 254 characters, and says it is too long', () => {
      type(`${'a'.repeat(250)}@example.org`);

      expect(getMentorCandidates).not.toHaveBeenCalled();
      expect(byTestId('mentorship-mentors-candidates-empty')?.textContent).toContain(MENTORSHIP_ADMIN_MENTOR_CANDIDATES_TOO_LONG_MESSAGE);
    });

    it.each(['alice', 'Alice Example', 'alice@example'])('says no one matches %s, with nothing to send', (text) => {
      getMentorCandidates.mockReturnValue(of({ data: [] }));
      type(text);

      expect(byTestId('mentorship-mentors-candidates-empty')?.textContent).toContain(MENTORSHIP_ADMIN_MENTOR_CANDIDATES_NO_MATCH_MESSAGE);
      expect(byTestId('mentorship-mentors-email-invite')).toBeNull();
      expect(sendButton()?.disabled).toBe(true);
    });

    it.each([
      [400, MENTORSHIP_ADMIN_MENTOR_INVITE_UNPUBLISHED_MESSAGE],
      [503, MENTORSHIP_ADMIN_MENTOR_CANDIDATES_UNAVAILABLE_MESSAGE],
      [500, MENTORSHIP_ADMIN_MENTOR_CANDIDATES_FAILED_MESSAGE],
    ])('on a %s offers no one, not even an email invite, and says why', (status, message) => {
      getMentorCandidates.mockReturnValue(throwError(() => new HttpErrorResponse({ status })));
      type('nobody@example.org');

      expect(byTestId('mentorship-mentors-candidates-empty')?.textContent).toContain(message);
      expect(byTestId('mentorship-mentors-email-invite')).toBeNull();
      expect(sendButton()?.disabled).toBe(true);
    });

    it('clears the search with the clear button', () => {
      type('priya');

      byTestId('mentorship-mentors-invite-search-clear')?.click();
      fixture.detectChanges();

      expect(component()['form'].controls.search.value).toBe('');
      expect(byTestId('mentorship-mentors-invite-prompt')).not.toBeNull();
    });
  });

  describe('invite an LF user', () => {
    it('sends the picked LFID, toasts and closes with the list changed', () => {
      type('priya');
      pick('priya');
      const row = byTestId('mentorship-mentors-candidate-priya');
      expect(row?.getAttribute('aria-pressed')).toBe('true');
      // A static `class` and a `[class]` binding merge, so the row keeps its layout next to the selected style.
      expect(row?.classList).toContain('flex');
      expect(row?.classList).toContain('w-full');
      expect(row?.classList).toContain('border-blue-300');
      expect(byTestId('mentorship-mentors-candidate-dsouza')?.classList).toContain('flex');
      expect(sendButton()?.disabled).toBe(false);

      sendButton()?.click();

      expect(inviteProgramMentor).toHaveBeenCalledWith('prog_1', { lfid: 'priya' });
      expect(toast.mock.calls[0][0]).toMatchObject({ severity: 'success', detail: MENTORSHIP_ADMIN_MENTOR_INVITED_MESSAGE });
      expect(onListChanged).toHaveBeenCalledTimes(1);
      expect(close).toHaveBeenCalledWith(true);
    });

    it('unpicks on a second click, and drops the pick when the search changes', () => {
      type('priya');
      pick('priya');
      pick('priya');
      expect(component()['selected']()).toBeNull();

      pick('priya');
      type('dsouza');
      expect(component()['selected']()).toBeNull();
      expect(sendButton()?.disabled).toBe(true);
    });

    it('on a 409 says the person is already on the program and closes so the list reloads', () => {
      inviteProgramMentor.mockReturnValue(throwError(() => new HttpErrorResponse({ status: 409 })));
      type('priya');
      pick('priya');

      component()['onSend']();

      expect(toast.mock.calls[0][0]).toMatchObject({ severity: 'error', detail: MENTORSHIP_ADMIN_MENTOR_INVITE_CONFLICT_MESSAGE });
      expect(onListChanged).toHaveBeenCalledTimes(1);
      expect(close).toHaveBeenCalledWith(true);
    });

    it.each([
      [400, MENTORSHIP_ADMIN_MENTOR_INVITE_UNPUBLISHED_MESSAGE],
      [422, MENTORSHIP_ADMIN_MENTOR_CANDIDATES_NO_ACCOUNT_MESSAGE],
      [503, MENTORSHIP_ADMIN_MENTOR_CANDIDATES_UNAVAILABLE_MESSAGE],
      [500, MENTORSHIP_ADMIN_MENTOR_INVITE_FAILED_MESSAGE],
    ])('on a %s shows its message and stays open with the pick, so the admin can retry', (status, message) => {
      inviteProgramMentor.mockReturnValue(throwError(() => new HttpErrorResponse({ status })));
      type('priya');
      pick('priya');

      component()['onSend']();
      fixture.detectChanges();

      expect(toast.mock.calls[0][0]).toMatchObject({ severity: 'error', detail: message });
      expect(close).not.toHaveBeenCalled();
      expect(onListChanged).not.toHaveBeenCalled();
      expect(component()['selected']()).toMatchObject({ lfid: 'priya' });
      expect(sendButton()?.disabled).toBe(false);
    });

    it.each([
      ['lfid "priya" has no LF account', MENTORSHIP_ADMIN_MENTOR_CANDIDATES_NO_ACCOUNT_MESSAGE],
      [
        'the primary email of lfid "priya" belongs to another Mentorship user',
        "This person's LF email address is already used by another Mentorship account, so they can't be invited.",
      ],
    ])('on a 422 for "%s" names that reason', (reason, message) => {
      const body = { error: `eligibility criteria not met: ${reason}`, code: 'VALIDATION_ERROR' };
      inviteProgramMentor.mockReturnValue(throwError(() => new HttpErrorResponse({ status: 422, error: body })));
      type('priya');
      pick('priya');

      component()['onSend']();

      expect(toast.mock.calls[0][0]).toMatchObject({ severity: 'error', detail: message });
    });

    it('shows the server text when the invite is refused during impersonation', () => {
      const body = { code: MENTORSHIP_IMPERSONATION_READ_ONLY_ERROR_CODE, message: 'Read only while impersonating.' };
      inviteProgramMentor.mockReturnValue(throwError(() => new HttpErrorResponse({ status: 403, error: body })));
      type('priya');
      pick('priya');

      component()['onSend']();

      expect(toast.mock.calls[0][0]).toMatchObject({ severity: 'error', detail: 'Read only while impersonating.' });
      expect(close).not.toHaveBeenCalled();
    });

    it('disables Send while the invite is in flight and sends one at a time', () => {
      const pending = new Subject<void>();
      inviteProgramMentor.mockReturnValue(pending);
      type('priya');
      pick('priya');

      component()['onSend']();
      fixture.detectChanges();
      expect(sendButton()?.disabled).toBe(true);
      expect(byTestId('mentorship-mentors-invite-cancel')?.querySelector('button')?.disabled).toBe(true);
      component()['onSend']();

      expect(inviteProgramMentor).toHaveBeenCalledTimes(1);
    });

    it('finishes a send the dialog was dismissed during: it still toasts and has the tab reload, and closes nothing', () => {
      const pending = new Subject<void>();
      inviteProgramMentor.mockReturnValue(pending);
      type('priya');
      pick('priya');
      component()['onSend']();

      fixture.destroy();
      pending.next();
      pending.complete();

      expect(toast.mock.calls[0][0]).toMatchObject({ severity: 'success', detail: MENTORSHIP_ADMIN_MENTOR_INVITED_MESSAGE });
      expect(onListChanged).toHaveBeenCalledTimes(1);
      expect(close).not.toHaveBeenCalled();
    });
  });

  describe('invite by email', () => {
    beforeEach(() => getMentorCandidates.mockReturnValue(of({ data: [] })));

    it('offers a full email no LF account uses, with the steps the invitee will take', () => {
      type(' new.mentor@example.org ');

      expect(byTestId('mentorship-mentors-candidates-empty')?.textContent).toContain(MENTORSHIP_ADMIN_MENTOR_CANDIDATES_EMAIL_INVITE_MESSAGE);
      expect(byTestId('mentorship-mentors-email-invite')?.textContent).toContain('Invite new.mentor@example.org by email');
      expect(byTestId('mentorship-mentors-email-invite-steps-intro')?.textContent?.trim()).toBe(MENTORSHIP_ADMIN_MENTOR_EMAIL_INVITE_STEPS_INTRO);
      const steps = Array.from(element().querySelectorAll('[data-testid="mentorship-mentors-email-invite-steps"] li')).map((li) => li.textContent?.trim());
      expect(steps).toEqual([...MENTORSHIP_ADMIN_MENTOR_EMAIL_INVITE_STEPS]);
      expect(sendButton()?.disabled).toBe(false);
      expect(sendButton()?.textContent).toContain('Send email invite');
    });

    it('sends only the email, toasts and closes with the list changed', () => {
      type('new.mentor@example.org');

      sendButton()?.click();

      expect(inviteProgramMentor).toHaveBeenCalledWith('prog_1', { email: 'new.mentor@example.org' });
      expect(toast.mock.calls[0][0]).toMatchObject({ severity: 'success', detail: MENTORSHIP_ADMIN_MENTOR_INVITED_BY_EMAIL_MESSAGE });
      expect(close).toHaveBeenCalledWith(true);
    });

    it('does not offer an email that finds an LF account', () => {
      getMentorCandidates.mockReturnValue(of({ data: [{ lfid: 'priya', name: 'Priya Natarajan' }] }));
      type('priya@example.org');

      expect(byTestId('mentorship-mentors-email-invite')).toBeNull();
      expect(byTestId('mentorship-mentors-candidate-priya')).not.toBeNull();
    });

    it('drops the offer as soon as the search changes, before the next answer', () => {
      type('new.mentor@example.org');
      component()['form'].controls.search.setValue('other.mentor@example.org');
      fixture.detectChanges();

      expect(component()['emailInvitee']()).toBeNull();
      expect(sendButton()?.disabled).toBe(true);
    });
  });

  describe('keys and closing', () => {
    const enter = (): void => {
      element()
        .querySelector('#mentorship-mentors-invite-search')
        ?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      fixture.detectChanges();
    };

    it('sends on Enter once there is something to send, and does nothing before', () => {
      getMentorCandidates.mockReturnValue(of({ data: [] }));
      type('alice');
      enter();
      expect(inviteProgramMentor).not.toHaveBeenCalled();

      type('new.mentor@example.org');
      enter();
      expect(inviteProgramMentor).toHaveBeenCalledWith('prog_1', { email: 'new.mentor@example.org' });
    });

    it('clears on Enter on the clear button rather than sending', () => {
      getMentorCandidates.mockReturnValue(of({ data: [] }));
      type('new.mentor@example.org');
      const clear = byTestId('mentorship-mentors-invite-search-clear');

      const event = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
      clear?.dispatchEvent(event);
      fixture.detectChanges();

      expect(event.defaultPrevented).toBe(false);
      expect(inviteProgramMentor).not.toHaveBeenCalled();
    });

    it('closes with nothing on Cancel', () => {
      byTestId('mentorship-mentors-invite-cancel')?.querySelector('button')?.click();

      expect(close).toHaveBeenCalledWith();
      expect(inviteProgramMentor).not.toHaveBeenCalled();
    });
  });
});
