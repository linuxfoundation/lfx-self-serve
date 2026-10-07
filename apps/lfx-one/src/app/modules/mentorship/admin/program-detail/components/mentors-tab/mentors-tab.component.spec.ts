// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpErrorResponse } from '@angular/common/http';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import {
  MENTORSHIP_ADMIN_MENTOR_ACTIONS_BY_STATUS,
  MENTORSHIP_ADMIN_MENTOR_CANDIDATES_FAILED_MESSAGE,
  MENTORSHIP_ADMIN_MENTOR_CANDIDATES_NO_ACCOUNT_MESSAGE,
  MENTORSHIP_ADMIN_MENTOR_CANDIDATES_NO_MATCH_MESSAGE,
  MENTORSHIP_ADMIN_MENTOR_CANDIDATES_TOO_LONG_MESSAGE,
  MENTORSHIP_ADMIN_MENTOR_CANDIDATES_UNAVAILABLE_MESSAGE,
  MENTORSHIP_ADMIN_MENTOR_INVITE_CONFLICT_MESSAGE,
  MENTORSHIP_ADMIN_MENTOR_INVITE_FAILED_MESSAGE,
  MENTORSHIP_ADMIN_MENTOR_INVITE_UNPUBLISHED_MESSAGE,
  MENTORSHIP_ADMIN_MENTOR_INVITED_MESSAGE,
  MENTORSHIP_ADMIN_MENTOR_CHANGED_MESSAGE,
  MENTORSHIP_ADMIN_MENTOR_STATUS_LABELS,
  MENTORSHIP_ADMIN_MENTOR_STATUSES,
  MENTORSHIP_IMPERSONATION_READ_ONLY_ERROR_CODE,
} from '@lfx-one/shared/constants';
import {
  MentorshipAdminMentorAction,
  MentorshipAdminMentorCandidatesResponse,
  MentorshipAdminMentorInviteRequest,
  MentorshipAdminMentorsQuery,
  MentorshipAdminMentorsResponse,
  MentorshipAdminMentorStatusUpdate,
  MentorshipProgramMentor,
} from '@lfx-one/shared/interfaces';
import { MentorshipAdminService } from '@services/mentorship-admin.service';
import { ConfirmationService, MessageService, ToastMessageOptions } from 'primeng/api';
import { Observable, of, Subject, throwError } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MentorsTabComponent } from './mentors-tab.component';

describe('MentorsTabComponent', () => {
  const mentor = (overrides: Partial<MentorshipProgramMentor> = {}): MentorshipProgramMentor => ({
    id: 'mem_1',
    name: 'Ifeoma Adeyemi',
    email: 'ifeoma.adeyemi@example.com',
    status: 'active',
    invitedOn: '2026-03-04',
    profileCreated: true,
    ...overrides,
  });

  const firstPage = (): MentorshipAdminMentorsResponse => ({
    data: [mentor(), mentor({ id: 'mem_2', name: 'Diego Souza', email: 'diego.souza@example.com', status: 'invited', profileCreated: false })],
    total: 12,
  });

  let fixture: ComponentFixture<MentorsTabComponent>;
  let getProgramMentors: ReturnType<typeof vi.fn<(programId: string, query: MentorshipAdminMentorsQuery) => Observable<MentorshipAdminMentorsResponse>>>;
  let updateProgramMentor: ReturnType<typeof vi.fn<(programId: string, memberId: string, body: MentorshipAdminMentorStatusUpdate) => Observable<void>>>;
  let getMentorCandidates: ReturnType<typeof vi.fn<(programId: string, search: string) => Observable<MentorshipAdminMentorCandidatesResponse>>>;
  let inviteProgramMentor: ReturnType<typeof vi.fn<(programId: string, body: MentorshipAdminMentorInviteRequest) => Observable<void>>>;

  /** Runs the effects that start a read, then renders what it wrote. */
  const settle = (): void => {
    fixture.detectChanges();
    fixture.detectChanges();
  };

  beforeEach(() => {
    getProgramMentors = vi.fn().mockReturnValue(of(firstPage()));
    updateProgramMentor = vi.fn().mockReturnValue(of(undefined));
    inviteProgramMentor = vi.fn().mockReturnValue(of(undefined));
    getMentorCandidates = vi.fn().mockReturnValue(
      of({
        data: [
          { lfid: 'priya', name: 'Priya Natarajan', avatarUrl: 'https://cdn.example.com/priya.png' },
          { lfid: 'dsouza', name: 'dsouza' },
        ],
      })
    );

    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [MentorsTabComponent],
      providers: [
        provideNoopAnimations(),
        MessageService,
        { provide: MentorshipAdminService, useValue: { getProgramMentors, updateProgramMentor, getMentorCandidates, inviteProgramMentor } },
      ],
    });

    fixture = TestBed.createComponent(MentorsTabComponent);
    fixture.componentRef.setInput('programId', 'prog_1');
    settle();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const element = (): HTMLElement => fixture.nativeElement as HTMLElement;
  const rowText = (id: string): string => (element().querySelector(`[data-testid="mentorship-mentor-row-${id}"]`)?.textContent ?? '').replace(/\s+/g, ' ');
  const lastQuery = (): MentorshipAdminMentorsQuery => getProgramMentors.mock.calls[getProgramMentors.mock.calls.length - 1][1];

  it('renders the columns from the design', () => {
    const headers = Array.from(element().querySelectorAll('thead th')).map((th) => (th.textContent ?? '').trim());

    expect(headers).toEqual(['Mentor', 'Status', 'Invitation / Application', 'Profile Created?', 'Actions']);
  });

  it('reads the first page of the program mentors', () => {
    expect(getProgramMentors).toHaveBeenCalledTimes(1);
    expect(getProgramMentors).toHaveBeenCalledWith('prog_1', { search: undefined, status: undefined, offset: 0, limit: 10 });
    expect(fixture.componentInstance['rows']().length).toBe(2);
    expect(fixture.componentInstance['total']()).toBe(12);
  });

  it('shows each mentor with its status, invitation date and profile flag', () => {
    expect(rowText('mem_1')).toContain('Ifeoma Adeyemi');
    expect(rowText('mem_1')).toContain(MENTORSHIP_ADMIN_MENTOR_STATUS_LABELS.active);
    expect(rowText('mem_1')).toContain('Yes');
    expect(rowText('mem_2')).toContain(MENTORSHIP_ADMIN_MENTOR_STATUS_LABELS.invited);
    expect(rowText('mem_2')).toContain('No');
  });

  it('offers every upstream status in the status filter', () => {
    expect(fixture.componentInstance['statusOptions'].map((option) => option.label)).toEqual([
      'All statuses',
      ...MENTORSHIP_ADMIN_MENTOR_STATUSES.map((status) => MENTORSHIP_ADMIN_MENTOR_STATUS_LABELS[status]),
    ]);
  });

  it('sends the chosen status upstream and returns to the first page', () => {
    const component = fixture.componentInstance;
    component['onLazyLoad']({ first: 10 });
    settle();
    expect(lastQuery().offset).toBe(10);

    component['form'].controls.status.setValue('declined');
    settle();

    expect(lastQuery()).toMatchObject({ status: 'declined', offset: 0 });
  });

  it('waits for typing to pause before searching, sends it trimmed, and returns to the first page', () => {
    vi.useFakeTimers();
    const component = fixture.componentInstance;
    component['onLazyLoad']({ first: 10 });
    settle();
    getProgramMentors.mockClear();

    component['form'].controls.search.setValue('Di');
    component['form'].controls.search.setValue('  Diego ');
    vi.advanceTimersByTime(100);
    settle();
    expect(getProgramMentors).not.toHaveBeenCalled();

    vi.advanceTimersByTime(300);
    settle();
    expect(getProgramMentors).toHaveBeenCalledTimes(1);
    expect(lastQuery()).toMatchObject({ search: 'Diego', offset: 0 });
  });

  describe('invite search', () => {
    const search = (query: string): void => {
      fixture.componentInstance['onCandidateSearch']({ originalEvent: new Event('input'), query });
    };

    it('asks upstream for the trimmed search of this program and offers each candidate by name and LFID, with no email', () => {
      search('  priya ');

      expect(getMentorCandidates).toHaveBeenCalledWith('prog_1', 'priya');
      const options = fixture.componentInstance['candidateOptions']();
      expect(options.map((option) => option.name)).toEqual(['Priya Natarajan', 'dsouza']);
      expect(options[0]).toMatchObject({ lfid: 'priya', initials: 'PN' });
      expect(JSON.stringify(options)).not.toContain('@');
    });

    it('does not send a pasted search over 254 characters, and says it is too long rather than blaming the program', () => {
      search(`${'a'.repeat(250)}@example.org`);

      expect(getMentorCandidates).not.toHaveBeenCalled();
      expect(fixture.componentInstance['candidatesEmptyMessage']()).toBe(MENTORSHIP_ADMIN_MENTOR_CANDIDATES_TOO_LONG_MESSAGE);
    });

    it('does not send a single emoji, which upstream counts as one character', () => {
      search('😀');

      expect(getMentorCandidates).not.toHaveBeenCalled();
    });

    it('does not ask upstream below two trimmed characters', () => {
      search(' p ');

      expect(getMentorCandidates).not.toHaveBeenCalled();
      expect(fixture.componentInstance['candidateOptions']()).toEqual([]);
    });

    it.each([
      ['alice@example.org', MENTORSHIP_ADMIN_MENTOR_CANDIDATES_NO_ACCOUNT_MESSAGE],
      ['alice', MENTORSHIP_ADMIN_MENTOR_CANDIDATES_NO_MATCH_MESSAGE],
      ['Priya', MENTORSHIP_ADMIN_MENTOR_CANDIDATES_NO_MATCH_MESSAGE],
      ['Alice Example', MENTORSHIP_ADMIN_MENTOR_CANDIDATES_NO_MATCH_MESSAGE],
      ['alice@example', MENTORSHIP_ADMIN_MENTOR_CANDIDATES_NO_MATCH_MESSAGE],
    ])('says why %s found no one', (query, message) => {
      getMentorCandidates.mockReturnValue(of({ data: [] }));

      search(query);

      expect(fixture.componentInstance['candidatesEmptyMessage']()).toBe(message);
    });

    it.each([
      [400, MENTORSHIP_ADMIN_MENTOR_INVITE_UNPUBLISHED_MESSAGE],
      [503, MENTORSHIP_ADMIN_MENTOR_CANDIDATES_UNAVAILABLE_MESSAGE],
      [500, MENTORSHIP_ADMIN_MENTOR_CANDIDATES_FAILED_MESSAGE],
    ])('on a %s offers no one and says the search failed', (status, message) => {
      search('priya');
      getMentorCandidates.mockReturnValue(throwError(() => new HttpErrorResponse({ status })));

      search('priyan');

      expect(fixture.componentInstance['candidateOptions']()).toEqual([]);
      expect(fixture.componentInstance['candidatesEmptyMessage']()).toBe(message);
    });

    it('enables Invite only once a candidate is picked, not for typed text', () => {
      const invitee = fixture.componentInstance['form'].controls.invitee;

      invitee.setValue('priya');
      expect(fixture.componentInstance['canInvite']()).toBe(false);

      invitee.setValue({ lfid: 'priya', name: 'Priya Natarajan' });
      expect(fixture.componentInstance['canInvite']()).toBe(true);
    });
  });

  it('shows an inline error with Retry when the read fails, and reads the same page again on Retry', () => {
    getProgramMentors.mockReturnValue(throwError(() => new HttpErrorResponse({ status: 503 })));
    fixture.componentInstance['onRetry']();
    settle();

    expect(element().querySelector('[data-testid="mentorship-admin-mentors-load-error"]')).not.toBeNull();
    expect(element().querySelector('table')).toBeNull();

    getProgramMentors.mockReturnValue(of(firstPage()));
    element().querySelector<HTMLElement>('[data-testid="mentorship-admin-mentors-retry"]')?.querySelector<HTMLButtonElement>('button')?.click();
    settle();

    expect(element().querySelector('[data-testid="mentorship-admin-mentors-load-error"]')).toBeNull();
    expect(fixture.componentInstance['rows']().length).toBe(2);
  });

  describe('invite', () => {
    const toasts = () => vi.spyOn(TestBed.inject(MessageService), 'add');
    const pick = (): void => fixture.componentInstance['form'].controls.invitee.setValue({ lfid: 'priya', name: 'Priya Natarajan' });

    it('sends the picked LFID, clears the field, toasts, reloads the page and has the parent refresh the counts', () => {
      const toast = toasts();
      const refresh = vi.fn();
      fixture.componentRef.setInput('countsRefresh', refresh);
      const reads = getProgramMentors.mock.calls.length;
      pick();

      fixture.componentInstance['onInviteMentor']();
      settle();

      expect(inviteProgramMentor).toHaveBeenCalledWith('prog_1', { lfid: 'priya' });
      expect(fixture.componentInstance['form'].controls.invitee.value).toBeNull();
      expect(toast.mock.calls[0][0]).toMatchObject({ severity: 'success', detail: MENTORSHIP_ADMIN_MENTOR_INVITED_MESSAGE });
      expect(refresh).toHaveBeenCalledTimes(1);
      expect(getProgramMentors.mock.calls.length).toBe(reads + 1);
    });

    it('sends nothing for text typed and not picked', () => {
      fixture.componentInstance['form'].controls.invitee.setValue('priya');

      fixture.componentInstance['onInviteMentor']();

      expect(inviteProgramMentor).not.toHaveBeenCalled();
    });

    it('on a 409 says the person is already on the program, clears the field and reloads the page', () => {
      inviteProgramMentor.mockReturnValue(throwError(() => new HttpErrorResponse({ status: 409 })));
      const toast = toasts();
      const reads = getProgramMentors.mock.calls.length;
      pick();

      fixture.componentInstance['onInviteMentor']();
      settle();

      expect(toast.mock.calls[0][0]).toMatchObject({ severity: 'error', detail: MENTORSHIP_ADMIN_MENTOR_INVITE_CONFLICT_MESSAGE });
      expect(fixture.componentInstance['form'].controls.invitee.value).toBeNull();
      expect(getProgramMentors.mock.calls.length).toBe(reads + 1);
    });

    it.each([
      [400, MENTORSHIP_ADMIN_MENTOR_INVITE_UNPUBLISHED_MESSAGE],
      [422, MENTORSHIP_ADMIN_MENTOR_CANDIDATES_NO_ACCOUNT_MESSAGE],
      [503, MENTORSHIP_ADMIN_MENTOR_CANDIDATES_UNAVAILABLE_MESSAGE],
      [500, MENTORSHIP_ADMIN_MENTOR_INVITE_FAILED_MESSAGE],
    ])('on a %s shows its message and keeps the pick so the admin can retry', (status, message) => {
      inviteProgramMentor.mockReturnValue(throwError(() => new HttpErrorResponse({ status })));
      const toast = toasts();
      const refresh = vi.fn();
      fixture.componentRef.setInput('countsRefresh', refresh);
      pick();

      fixture.componentInstance['onInviteMentor']();

      expect(toast.mock.calls[0][0]).toMatchObject({ severity: 'error', detail: message });
      expect(fixture.componentInstance['form'].controls.invitee.value).toMatchObject({ lfid: 'priya' });
      expect(refresh).not.toHaveBeenCalled();
      expect(fixture.componentInstance['canInvite']()).toBe(true);
    });

    it('shows the server text when the invite is refused during impersonation', () => {
      const body = { code: MENTORSHIP_IMPERSONATION_READ_ONLY_ERROR_CODE, message: 'Read only while impersonating.' };
      inviteProgramMentor.mockReturnValue(throwError(() => new HttpErrorResponse({ status: 403, error: body })));
      const toast = toasts();
      pick();

      fixture.componentInstance['onInviteMentor']();

      expect(toast.mock.calls[0][0]).toMatchObject({ severity: 'error', detail: 'Read only while impersonating.' });
    });

    it('disables Invite while the invite is in flight and sends one at a time', () => {
      const pending = new Subject<void>();
      inviteProgramMentor.mockReturnValue(pending);
      const toast = toasts();
      pick();

      fixture.componentInstance['onInviteMentor']();
      expect(fixture.componentInstance['canInvite']()).toBe(false);
      fixture.componentInstance['onInviteMentor']();

      expect(inviteProgramMentor).toHaveBeenCalledTimes(1);
      expect(toast.mock.calls[0][0]).toMatchObject({ severity: 'info', summary: 'Please wait' });
    });
  });

  describe('row actions', () => {
    const actionIds = (id: string): string[] =>
      Array.from(element().querySelectorAll(`[data-testid="mentorship-mentor-row-${id}"] button[data-testid^="mentorship-admin-mentors-"]`)).map((button) =>
        (button.getAttribute('data-testid') ?? '').replace(`mentorship-admin-mentors-`, '').replace(`-${id}`, '')
      );
    const actionFor = (status: MentorshipProgramMentor['status'], key: MentorshipAdminMentorAction['key']): MentorshipAdminMentorAction =>
      MENTORSHIP_ADMIN_MENTOR_ACTIONS_BY_STATUS[status].find((action) => action.key === key)!;
    const confirmSpy = () => vi.spyOn(fixture.debugElement.injector.get(ConfirmationService), 'confirm');
    const toasts = () => vi.spyOn(TestBed.inject(MessageService), 'add');
    /** Opens the confirm for one row's action and accepts it. */
    const confirmAction = (id: string, status: MentorshipProgramMentor['status'], key: MentorshipAdminMentorAction['key']) => {
      const confirm = confirmSpy();
      fixture.componentInstance['onMentorAction'](mentor({ id, status }), actionFor(status, key));
      confirm.mock.calls[0][0].accept?.();
      return confirm;
    };

    it('offers each mentor the actions its status allows, and no Delete', () => {
      expect(actionIds('mem_1')).toEqual(['remove']);
      expect(actionIds('mem_2')).toEqual(['revoke']);
      expect(element().querySelector('[data-testid^="mentorship-admin-mentors-delete-"]')).toBeNull();
    });

    it.each([
      ['requested', ['accept', 'decline']],
      ['pending', ['accept', 'decline']],
      ['invited', ['revoke']],
      ['active', ['remove']],
      ['declined', []],
      ['withdrawn', []],
    ] as const)('offers a %s mentor %j', (status, keys) => {
      getProgramMentors.mockReturnValue(of({ data: [mentor({ id: 'mem_9', status })], total: 1 }));
      fixture.componentInstance['onRetry']();
      settle();

      expect(actionIds('mem_9')).toEqual([...keys]);
    });

    it('does not write until the confirm is accepted', () => {
      const confirm = confirmSpy();

      fixture.componentInstance['onMentorAction'](mentor(), actionFor('active', 'remove'));

      expect(confirm).toHaveBeenCalledTimes(1);
      expect(updateProgramMentor).not.toHaveBeenCalled();
    });

    it.each([
      ['requested', 'accept', 'active'],
      ['requested', 'decline', 'declined'],
      ['invited', 'revoke', 'declined'],
      ['active', 'remove', 'withdrawn'],
    ] as const)('a confirmed %s mentor %s sends the status %s', (status, key, sent) => {
      confirmAction('mem_1', status, key);

      expect(updateProgramMentor).toHaveBeenCalledWith('prog_1', 'mem_1', { status: sent });
    });

    it('on success toasts, reloads the page and has the parent refresh the counts', () => {
      const toast = toasts();
      const refresh = vi.fn();
      fixture.componentRef.setInput('countsRefresh', refresh);
      const reads = getProgramMentors.mock.calls.length;

      confirmAction('mem_1', 'active', 'remove');
      settle();

      expect(toast.mock.calls[0][0]).toMatchObject({ severity: 'success', detail: 'Mentor removed.' });
      expect(refresh).toHaveBeenCalledTimes(1);
      expect(getProgramMentors.mock.calls.length).toBe(reads + 1);
    });

    it('on a 409 reloads the page and says the mentor changed, without refreshing the counts', () => {
      updateProgramMentor.mockReturnValue(throwError(() => new HttpErrorResponse({ status: 409 })));
      const toast = toasts();
      const refresh = vi.fn();
      fixture.componentRef.setInput('countsRefresh', refresh);
      const reads = getProgramMentors.mock.calls.length;

      confirmAction('mem_1', 'active', 'remove');
      settle();

      const shown = toast.mock.calls[0][0] as ToastMessageOptions;
      expect(shown).toMatchObject({ severity: 'error', detail: MENTORSHIP_ADMIN_MENTOR_CHANGED_MESSAGE });
      expect(getProgramMentors.mock.calls.length).toBe(reads + 1);
      expect(refresh).not.toHaveBeenCalled();
    });

    it('on any other failure shows the generic error and leaves the page as it is', () => {
      updateProgramMentor.mockReturnValue(throwError(() => new HttpErrorResponse({ status: 502 })));
      const toast = toasts();
      const reads = getProgramMentors.mock.calls.length;

      confirmAction('mem_1', 'active', 'remove');
      settle();

      expect(toast.mock.calls[0][0]).toMatchObject({ severity: 'error', detail: "The change couldn't be saved. Please try again." });
      expect(getProgramMentors.mock.calls.length).toBe(reads);
    });

    it('shows the server text when the write is refused during impersonation', () => {
      const body = { code: MENTORSHIP_IMPERSONATION_READ_ONLY_ERROR_CODE, message: 'Read only while impersonating.' };
      updateProgramMentor.mockReturnValue(throwError(() => new HttpErrorResponse({ status: 403, error: body })));
      const toast = toasts();

      confirmAction('mem_1', 'active', 'remove');

      expect(toast.mock.calls[0][0]).toMatchObject({ severity: 'error', detail: 'Read only while impersonating.' });
    });

    it('sends one write at a time', () => {
      const pending = new Subject<void>();
      updateProgramMentor.mockReturnValue(pending);
      const toast = toasts();

      confirmAction('mem_1', 'active', 'remove');
      confirmAction('mem_2', 'invited', 'revoke');

      expect(updateProgramMentor).toHaveBeenCalledTimes(1);
      expect(toast.mock.calls[0][0]).toMatchObject({ severity: 'info', summary: 'Please wait' });
    });

    it('still toasts and refreshes the counts when the tab is destroyed mid-write, without reloading', () => {
      const pending = new Subject<void>();
      updateProgramMentor.mockReturnValue(pending);
      const toast = toasts();
      const refresh = vi.fn();
      fixture.componentRef.setInput('countsRefresh', refresh);
      confirmAction('mem_1', 'active', 'remove');
      const reads = getProgramMentors.mock.calls.length;

      fixture.destroy();
      pending.next();
      pending.complete();

      expect(toast.mock.calls[0][0]).toMatchObject({ severity: 'success' });
      expect(refresh).toHaveBeenCalledTimes(1);
      expect(getProgramMentors.mock.calls.length).toBe(reads);
    });
  });
});
