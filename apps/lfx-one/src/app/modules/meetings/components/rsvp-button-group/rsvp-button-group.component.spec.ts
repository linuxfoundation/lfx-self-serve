// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { computed, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Meeting, MeetingRsvp, RsvpResponse, RsvpScope, User } from '@lfx-one/shared/interfaces';
import { LensService } from '@services/lens.service';
import { UserService } from '@services/user.service';

import { MessageService } from 'primeng/api';
import { DialogService } from 'primeng/dynamicdialog';
import { Subject } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { RsvpButtonGroupComponent } from './rsvp-button-group.component';

const FIRST_DATE = '4071031200';
const SECOND_DATE = '4071636000';
const MEETING = {
  id: 'synthetic-recurring-rsvp',
  title: 'Synthetic recurring meeting',
  start_time: '2099-01-02T10:00:00Z',
  duration: 30,
  timezone: 'UTC',
  invited: true,
  is_invite_responses_enabled: true,
  recurrence: { type: 2, repeat_interval: 1 },
  occurrences: [
    { occurrence_id: FIRST_DATE, start_time: '2099-01-02T10:00:00Z', duration: 30 },
    { occurrence_id: SECOND_DATE, start_time: '2099-01-09T10:00:00Z', duration: 30 },
  ],
} as Meeting;

function response(responseType: RsvpResponse, scope: RsvpScope, occurrenceId?: string): MeetingRsvp {
  return {
    id: `synthetic-${responseType}-${scope}`,
    meeting_id: MEETING.id,
    registrant_id: 'synthetic-registrant',
    username: 'synthetic-viewer',
    email: 'synthetic@example.com',
    response_type: responseType,
    scope,
    occurrence_id: occurrenceId,
    created_at: '2026-10-10T10:00:00Z',
  };
}

describe('RsvpButtonGroupComponent — confirmed occurrence responses', () => {
  let http: HttpTestingController;
  let toastAdd: ReturnType<typeof vi.fn>;
  let dialogOpen: ReturnType<typeof vi.fn>;
  let dialogClose: Subject<{ confirmed: boolean; scope?: RsvpScope }>;
  let user: ReturnType<typeof signal<User>>;

  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-10T10:00:00Z'));
    toastAdd = vi.fn();
    dialogClose = new Subject();
    dialogOpen = vi.fn(() => ({ onClose: dialogClose }));
    user = signal({
      username: 'synthetic-viewer',
      email: 'synthetic@example.com',
      'https://sso.linuxfoundation.org/claims/username': 'canonical-viewer',
    } as User);
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        {
          provide: UserService,
          useValue: {
            user,
            viewerUsername: computed(() => user()['https://sso.linuxfoundation.org/claims/username'] || user().username || null),
            authenticated: signal(true),
            refreshUserMeetings: vi.fn(),
            meetingRegistrationGeneration: vi.fn(() => 0),
            recordConfirmedMeetingRsvp: vi.fn(),
            confirmedMeetingRsvps: vi.fn(() => []),
            isMeetingRsvpCurrent: vi.fn(() => true),
          },
        },
        { provide: MessageService, useValue: { add: toastAdd } },
        { provide: DialogService, useValue: { open: dialogOpen } },
        { provide: LensService, useValue: { activeLens: signal('me') } },
      ],
    });
    TestBed.overrideComponent(RsvpButtonGroupComponent, { set: { providers: [] } });
    await TestBed.compileComponents();
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    http.verify();
    vi.useRealTimers();
  });

  async function mount(meeting = MEETING, inputs: Record<string, unknown> = {}) {
    const fixture = TestBed.createComponent(RsvpButtonGroupComponent);
    fixture.componentRef.setInput('meeting', meeting);
    for (const [name, value] of Object.entries(inputs)) {
      fixture.componentRef.setInput(name, value);
    }
    fixture.detectChanges();
    TestBed.tick();
    return fixture;
  }

  function flushRead(rsvp: MeetingRsvp | null, occurrenceId = FIRST_DATE) {
    const read = http.expectOne((request) => request.url === `/api/meetings/${MEETING.id}/rsvp/me` && request.params.get('occurrenceId') === occurrenceId);
    read.flush(rsvp);
  }

  describe.each([false, true])('Change response shortcut (compact=%s)', (compact) => {
    it.each([
      ['accepted', 'yes'],
      ['maybe', 'maybe'],
      ['declined', 'no'],
    ] as const)('focuses the selected %s control without saving or opening the scope dialog', async (answer, buttonName) => {
      const current = response(answer, 'single', FIRST_DATE);
      const fixture = await mount({ ...MEETING, my_rsvp: current }, { compact, showHeader: false });
      flushRead(current);
      fixture.detectChanges();
      const component = fixture.componentInstance;
      const changed = vi.fn();
      component.rsvpChanged.subscribe(changed);
      const host = fixture.nativeElement as HTMLElement;
      document.body.appendChild(host);
      const shortcut = host.querySelector<HTMLButtonElement>('[data-testid="meeting-rsvp-change-response"]')!;
      const selected = host.querySelector<HTMLButtonElement>(`[data-testid="meeting-rsvp-button-${buttonName}"]`)!;
      expect(shortcut.closest('[aria-live]')).toBeNull();
      shortcut.focus();
      shortcut.click();

      expect(document.activeElement).toBe(selected);
      expect(component.currentRsvp()).toEqual(current);
      expect(component.responseSaved()).toBe(false);
      expect(changed).not.toHaveBeenCalled();
      expect(dialogOpen).not.toHaveBeenCalled();
      expect(toastAdd).not.toHaveBeenCalled();
      http.expectNone(`/api/meetings/${MEETING.id}/rsvp`);
      fixture.destroy();
      host.remove();
    });

    it('does not show a shortcut before a response exists', async () => {
      const fixture = await mount(MEETING, { compact });
      flushRead(null);
      fixture.detectChanges();
      expect(fixture.nativeElement.querySelector('[data-testid="meeting-rsvp-change-response"]')).toBeNull();
      fixture.destroy();
    });

    it('does not offer changing a response when RSVP is disabled', async () => {
      const current = response('accepted', 'all');
      const fixture = await mount({ ...MEETING, my_rsvp: current }, { compact });
      flushRead(current);
      fixture.componentRef.setInput('disabled', true);
      fixture.detectChanges();
      TestBed.tick();
      expect(fixture.nativeElement.querySelector('[data-testid="meeting-rsvp-change-response"]')).toBeNull();
      const controls = fixture.nativeElement.querySelectorAll('[data-testid^="meeting-rsvp-button-"]') as NodeListOf<HTMLButtonElement>;
      for (const control of controls) expect(control.disabled).toBe(true);
      http.expectNone(`/api/meetings/${MEETING.id}/rsvp`);
      fixture.destroy();
    });

    it('does not focus or change a response while saving', async () => {
      const current = response('accepted', 'all');
      const fixture = await mount({ ...MEETING, my_rsvp: current }, { compact });
      flushRead(current);
      fixture.componentInstance.isLoading.set(true);
      fixture.detectChanges();
      TestBed.tick();
      const host = fixture.nativeElement as HTMLElement;
      const shortcut = host.querySelector<HTMLButtonElement>('[data-testid="meeting-rsvp-change-response"]')!;
      const selected = host.querySelector<HTMLButtonElement>('[data-testid="meeting-rsvp-button-yes"]')!;
      const focus = vi.spyOn(selected, 'focus');
      expect(shortcut.disabled).toBe(true);
      shortcut.click();
      shortcut.dispatchEvent(new MouseEvent('click'));
      expect(focus).not.toHaveBeenCalled();
      expect(dialogOpen).not.toHaveBeenCalled();
      expect(toastAdd).not.toHaveBeenCalled();
      http.expectNone(`/api/meetings/${MEETING.id}/rsvp`);
      fixture.destroy();
    });
  });

  it.each(['single', 'this_and_following'] as const)('resolves the actual card date for a %s write when no occurrence input was supplied', async (scope) => {
    const fixture = await mount();
    flushRead(null);
    const component = fixture.componentInstance;
    component.handleRsvpClick('declined');
    http.expectNone(`/api/meetings/${MEETING.id}/rsvp`);
    expect(dialogOpen).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ data: expect.objectContaining({ canSelectOccurrence: true }) }));

    dialogClose.next({ confirmed: true, scope });
    const write = http.expectOne(`/api/meetings/${MEETING.id}/rsvp`);
    expect(write.request.method).toBe('POST');
    expect(write.request.body).toEqual({ response: 'declined', scope, email: 'synthetic@example.com', occurrence_id: FIRST_DATE });
    // The API can omit the direct occurrence field; the successful scoped request still identifies it.
    write.flush(response('declined', scope));
    expect(component.currentRsvp()?.occurrence_id).toBe(FIRST_DATE);
    expect(component.selectedResponse()).toBe('declined');
    expect(component.responseSaved()).toBe(true);
  });

  it('keeps a single decline on its date and preserves the prior all-dates response on another date', async () => {
    const fixture = await mount();
    flushRead(null);
    const component = fixture.componentInstance;
    const host = fixture.nativeElement as HTMLElement;
    host.querySelector<HTMLButtonElement>('[data-testid="meeting-rsvp-button-yes"]')!.click();
    dialogClose.next({ confirmed: true, scope: 'all' });
    const allWrite = http.expectOne(`/api/meetings/${MEETING.id}/rsvp`);
    expect(allWrite.request.body).toEqual({ response: 'accepted', scope: 'all', email: 'synthetic@example.com' });
    allWrite.flush(response('accepted', 'all'));

    fixture.detectChanges();
    host.querySelector<HTMLButtonElement>('[data-testid="meeting-rsvp-button-no"]')!.click();
    dialogClose.next({ confirmed: true, scope: 'single' });
    http.expectOne(`/api/meetings/${MEETING.id}/rsvp`).flush(response('declined', 'single', FIRST_DATE));
    expect(component.selectedResponse()).toBe('declined');

    fixture.componentRef.setInput('occurrenceId', SECOND_DATE);
    fixture.detectChanges();
    TestBed.tick();
    // Even a stale fallback from the other date cannot mark this date declined.
    flushRead(response('declined', 'single', FIRST_DATE), SECOND_DATE);
    expect(component.selectedResponse()).toBe('accepted');
    expect(component.currentRsvp()?.scope).toBe('all');

    fixture.componentRef.setInput('occurrenceId', FIRST_DATE);
    fixture.detectChanges();
    TestBed.tick();
    flushRead(response('accepted', 'all'));
    expect(component.selectedResponse()).toBe('declined');
    expect(component.currentRsvp()?.scope).toBe('single');
  });

  it('does not treat another date’s supplied or fetched single response as an answer to the displayed date', async () => {
    const wrongDate = response('declined', 'single', SECOND_DATE);
    const fixture = await mount({ ...MEETING, my_rsvp: wrongDate });
    flushRead(wrongDate);
    expect(fixture.componentInstance.selectedResponse()).toBeNull();
    expect(fixture.componentInstance.responseSaved()).toBe(false);
  });

  it('retains a confirmed response across a failed change and stale reads without announcing a failed save', async () => {
    const fixture = await mount();
    flushRead(null);
    const component = fixture.componentInstance;
    const changed = vi.fn();
    const failed = vi.fn();
    component.rsvpChanged.subscribe(changed);
    component.rsvpFailed.subscribe(failed);
    component.handleRsvpClick('accepted');
    dialogClose.next({ confirmed: true, scope: 'single' });
    http.expectOne(`/api/meetings/${MEETING.id}/rsvp`).flush(response('accepted', 'single', FIRST_DATE));
    expect(changed).toHaveBeenCalledTimes(1);
    expect(toastAdd).toHaveBeenCalledWith(expect.objectContaining({ severity: 'success' }));
    toastAdd.mockClear();

    component.handleRsvpClick('declined');
    dialogClose.next({ confirmed: true, scope: 'all' });
    expect(component.selectedResponse()).toBe('accepted');
    expect(component.isLoading()).toBe(true);
    http.expectOne(`/api/meetings/${MEETING.id}/rsvp`).flush({ error: 'Synthetic rejection' }, { status: 403, statusText: 'Forbidden' });
    expect(changed).toHaveBeenCalledTimes(1);
    expect(failed).toHaveBeenCalledWith('Synthetic rejection');
    expect(component.isLoading()).toBe(false);
    expect(component.selectedResponse()).toBe('accepted');
    expect(toastAdd).toHaveBeenCalledTimes(1);
    expect(toastAdd).toHaveBeenCalledWith(expect.objectContaining({ severity: 'error' }));

    fixture.componentRef.setInput('meeting', { ...MEETING, my_rsvp: null });
    fixture.detectChanges();
    TestBed.tick();
    flushRead(null);
    expect(component.selectedResponse()).toBe('accepted');
    expect(component.responseSaved()).toBe(true);
  });

  it('lets a newer server response supersede a confirmed save while keeping the local response on timestamp ties', async () => {
    const fixture = await mount();
    flushRead(null);
    fixture.componentInstance.handleRsvpClick('accepted');
    dialogClose.next({ confirmed: true, scope: 'all' });
    http.expectOne(`/api/meetings/${MEETING.id}/rsvp`).flush(response('accepted', 'all'));

    fixture.componentRef.setInput('meeting', { ...MEETING });
    fixture.detectChanges();
    TestBed.tick();
    flushRead(response('declined', 'all'));
    expect(fixture.componentInstance.selectedResponse()).toBe('accepted');

    const newer = { ...response('declined', 'all'), modified_at: '2026-10-10T11:00:00Z' };
    fixture.componentRef.setInput('meeting', { ...MEETING, my_rsvp: newer });
    fixture.detectChanges();
    TestBed.tick();
    flushRead(newer);
    expect(fixture.componentInstance.selectedResponse()).toBe('declined');
    expect(fixture.componentInstance.responseSaved()).toBe(false);
  });

  it('reconciles an undated successful acknowledgement with a later indexed response', async () => {
    const fixture = await mount();
    flushRead(null);
    fixture.componentInstance.handleRsvpClick('accepted');
    dialogClose.next({ confirmed: true, scope: 'all' });
    const undated = { ...response('accepted', 'all'), created_at: undefined };
    http.expectOne(`/api/meetings/${MEETING.id}/rsvp`).flush(undated);
    expect(fixture.componentInstance.selectedResponse()).toBe('accepted');

    const newer = { ...response('declined', 'all'), modified_at: '2026-10-10T11:00:00Z' };
    fixture.componentRef.setInput('meeting', { ...MEETING, my_rsvp: newer });
    fixture.detectChanges();
    TestBed.tick();
    flushRead(newer);
    expect(fixture.componentInstance.selectedResponse()).toBe('declined');
    expect(fixture.componentInstance.responseSaved()).toBe(false);
  });

  it('retains a changed answer when the acknowledgement only carries its original creation time', async () => {
    const indexed = { ...response('accepted', 'all'), modified_at: '2026-10-10T11:00:00Z' };
    vi.setSystemTime(new Date('2026-10-10T12:00:00Z'));
    const fixture = await mount({ ...MEETING, my_rsvp: indexed });
    flushRead(indexed);
    expect(fixture.componentInstance.selectedResponse()).toBe('accepted');

    fixture.componentInstance.handleRsvpClick('declined');
    dialogClose.next({ confirmed: true, scope: 'all' });
    http.expectOne(`/api/meetings/${MEETING.id}/rsvp`).flush(response('declined', 'all'));
    expect(fixture.componentInstance.selectedResponse()).toBe('declined');
    expect(fixture.componentInstance.responseSaved()).toBe(true);

    fixture.componentRef.setInput('meeting', { ...MEETING, my_rsvp: indexed });
    fixture.detectChanges();
    TestBed.tick();
    flushRead(indexed);
    expect(fixture.componentInstance.selectedResponse()).toBe('declined');

    const newer = { ...indexed, modified_at: '2026-10-10T13:00:00Z' };
    fixture.componentRef.setInput('meeting', { ...MEETING, my_rsvp: newer });
    fixture.detectChanges();
    TestBed.tick();
    flushRead(newer);
    expect(fixture.componentInstance.selectedResponse()).toBe('accepted');
    expect(fixture.componentInstance.responseSaved()).toBe(false);
  });

  it('applies a confirmed all-dates response to another date without sending an occurrence ID', async () => {
    const fixture = await mount();
    flushRead(null);
    fixture.componentInstance.handleRsvpClick('declined');
    dialogClose.next({ confirmed: true, scope: 'all' });
    const write = http.expectOne(`/api/meetings/${MEETING.id}/rsvp`);
    expect(write.request.body.occurrence_id).toBeUndefined();
    write.flush(response('declined', 'all'));
    fixture.componentRef.setInput('occurrenceId', SECOND_DATE);
    fixture.detectChanges();
    TestBed.tick();
    flushRead(null, SECOND_DATE);
    expect(fixture.componentInstance.selectedResponse()).toBe('declined');
    expect(fixture.componentInstance.currentRsvp()?.scope).toBe('all');
  });

  it('publishes the global success feedback before a consumer removes the component', async () => {
    const fixture = await mount();
    flushRead(null);
    fixture.componentInstance.rsvpChanged.subscribe(() => {
      expect(toastAdd).toHaveBeenCalledWith(expect.objectContaining({ severity: 'success' }));
      fixture.destroy();
    });
    fixture.componentInstance.handleRsvpClick('maybe');
    dialogClose.next({ confirmed: true, scope: 'all' });
    http.expectOne(`/api/meetings/${MEETING.id}/rsvp`).flush(response('maybe', 'all'));
  });

  it('respects the independently suppressible success and failure toasts while still emitting results', async () => {
    const fixture = await mount(MEETING, { suppressToast: true, suppressErrorToast: true });
    flushRead(null);
    const changed = vi.fn();
    const failed = vi.fn();
    fixture.componentInstance.rsvpChanged.subscribe(changed);
    fixture.componentInstance.rsvpFailed.subscribe(failed);
    fixture.componentInstance.handleRsvpClick('maybe');
    dialogClose.next({ confirmed: true, scope: 'all' });
    http.expectOne(`/api/meetings/${MEETING.id}/rsvp`).flush(response('maybe', 'all'));
    fixture.componentInstance.handleRsvpClick('declined');
    dialogClose.next({ confirmed: true, scope: 'single' });
    http.expectOne(`/api/meetings/${MEETING.id}/rsvp`).flush({ error: 'Synthetic rejection' }, { status: 403, statusText: 'Forbidden' });
    expect(toastAdd).not.toHaveBeenCalled();
    expect(changed).toHaveBeenCalledTimes(1);
    expect(failed).toHaveBeenCalledTimes(1);
    expect(fixture.componentInstance.selectedResponse()).toBe('maybe');
  });

  it.each(['single', 'this_and_following'] as const)('does not submit a %s modal response after the displayed date changed', async (scope) => {
    const fixture = await mount();
    flushRead(null);
    fixture.componentInstance.handleRsvpClick('declined');
    fixture.componentRef.setInput('occurrenceId', SECOND_DATE);
    fixture.detectChanges();
    TestBed.tick();
    flushRead(null, SECOND_DATE);
    dialogClose.next({ confirmed: true, scope });
    http.expectNone(`/api/meetings/${MEETING.id}/rsvp`);
  });

  it('submits an all-dates modal response after the displayed date changes', async () => {
    const fixture = await mount();
    flushRead(null);
    fixture.componentInstance.handleRsvpClick('declined');
    fixture.componentRef.setInput('occurrenceId', SECOND_DATE);
    fixture.detectChanges();
    TestBed.tick();
    flushRead(null, SECOND_DATE);
    dialogClose.next({ confirmed: true, scope: 'all' });
    const write = http.expectOne(`/api/meetings/${MEETING.id}/rsvp`);
    expect(write.request.body).toEqual({ response: 'declined', scope: 'all', email: 'synthetic@example.com' });
    write.flush(response('declined', 'all'));
    expect(fixture.componentInstance.selectedResponse()).toBe('declined');
    expect(fixture.componentInstance.responseScopeLabel()).toBe('All dates');
  });

  it('keeps the dialog and confirmed response attached to the canonical viewer when the display alias changes', async () => {
    const fixture = await mount();
    flushRead(null);
    fixture.componentInstance.handleRsvpClick('accepted');
    user.update((current) => ({ ...current, username: 'new-display-alias' }));
    fixture.detectChanges();
    TestBed.tick();
    flushRead(null);
    dialogClose.next({ confirmed: true, scope: 'single' });
    http.expectOne(`/api/meetings/${MEETING.id}/rsvp`).flush(response('accepted', 'single', FIRST_DATE));
    user.update((current) => ({ ...current, username: 'another-display-alias' }));
    fixture.detectChanges();
    TestBed.tick();
    flushRead(null);
    expect(fixture.componentInstance.selectedResponse()).toBe('accepted');
    expect(fixture.componentInstance.responseSaved()).toBe(true);
  });

  it('retains a confirmed answer across late canonical LFID arrival but clears it for another subject', async () => {
    user.set({ sub: 'synthetic-a', username: 'display-alias', email: 'synthetic@example.com' } as User);
    const fixture = await mount();
    flushRead(null);
    fixture.componentInstance.handleRsvpClick('accepted');
    dialogClose.next({ confirmed: true, scope: 'all' });
    http.expectOne(`/api/meetings/${MEETING.id}/rsvp`).flush(response('accepted', 'all'));

    user.update((current) => ({ ...current, 'https://sso.linuxfoundation.org/claims/username': 'canonical-viewer' }));
    fixture.detectChanges();
    TestBed.tick();
    for (const request of http.match((request) => request.url === `/api/meetings/${MEETING.id}/rsvp/me`)) {
      if (!request.cancelled) request.flush(null);
    }
    expect(fixture.componentInstance.selectedResponse()).toBe('accepted');
    expect(fixture.componentInstance.responseSaved()).toBe(true);

    user.update((current) => ({ ...current, sub: 'synthetic-b' }));
    fixture.detectChanges();
    TestBed.tick();
    flushRead(null);
    expect(fixture.componentInstance.selectedResponse()).toBeNull();
    expect(fixture.componentInstance.responseSaved()).toBe(false);
  });

  it('submits a dialog response when the same date changes from seconds to milliseconds', async () => {
    const fixture = await mount();
    flushRead(null);
    fixture.componentInstance.handleRsvpClick('declined');
    fixture.componentRef.setInput('occurrenceId', `${FIRST_DATE}000`);
    fixture.detectChanges();
    TestBed.tick();
    flushRead(null, `${FIRST_DATE}000`);
    dialogClose.next({ confirmed: true, scope: 'single' });
    const write = http.expectOne(`/api/meetings/${MEETING.id}/rsvp`);
    expect(write.request.body.occurrence_id).toBe(FIRST_DATE);
    write.flush(response('declined', 'single', FIRST_DATE));
    expect(fixture.componentInstance.selectedResponse()).toBe('declined');
  });

  it('keeps the fetched response visible while refetching an equivalent millisecond date', async () => {
    const fixture = await mount();
    flushRead(response('accepted', 'single', FIRST_DATE));
    fixture.componentRef.setInput('occurrenceId', `${FIRST_DATE}000`);
    fixture.detectChanges();
    TestBed.tick();
    expect(fixture.componentInstance.selectedResponse()).toBe('accepted');
    flushRead(response('accepted', 'single', FIRST_DATE), `${FIRST_DATE}000`);
  });

  it('does not submit a dialog response after the card is destroyed', async () => {
    const fixture = await mount();
    flushRead(null);
    fixture.componentInstance.handleRsvpClick('accepted');
    fixture.destroy();
    dialogClose.next({ confirmed: true, scope: 'all' });
    http.expectNone(`/api/meetings/${MEETING.id}/rsvp`);
  });

  it('keeps a hidden-header compact status available through a saved response', async () => {
    const fixture = await mount(MEETING, { compact: true, showHeader: false });
    flushRead(null);
    const host = fixture.nativeElement as HTMLElement;
    const status = host.querySelector<HTMLElement>('[role="status"]')!;
    expect(status.textContent).toContain('Will you attend?');
    fixture.componentInstance.handleRsvpClick('accepted');
    dialogClose.next({ confirmed: true, scope: 'all' });
    http.expectOne(`/api/meetings/${MEETING.id}/rsvp`).flush(response('accepted', 'all'));
    fixture.detectChanges();
    expect(host.querySelector('[role="status"]')).toBe(status);
    expect(status.textContent).toContain('Response saved: Going');
    expect(status.textContent).toContain('All dates');
  });

  it('does not send an undefined occurrence ID for a scoped save when no upcoming date can be resolved', async () => {
    const fixture = await mount({ ...MEETING, occurrences: [] });
    http.expectOne((request) => request.url === `/api/meetings/${MEETING.id}/rsvp/me` && !request.params.has('occurrenceId')).flush(null);
    fixture.componentInstance.handleRsvpClick('declined');
    expect(dialogOpen).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ data: expect.objectContaining({ canSelectOccurrence: false }) }));
    dialogClose.next({ confirmed: true, scope: 'single' });
    http.expectNone(`/api/meetings/${MEETING.id}/rsvp`);
    expect(fixture.componentInstance.isLoading()).toBe(false);
    expect(toastAdd).toHaveBeenCalledWith(expect.objectContaining({ severity: 'error' }));
  });
});

describe('RsvpButtonGroupComponent — registration lifetime', () => {
  let http: HttpTestingController;
  let users: UserService;
  let toastAdd: ReturnType<typeof vi.fn>;
  const meeting = { ...MEETING, recurrence: null, occurrences: [], my_registrant_ids: ['synthetic-registrant'] } as Meeting;
  const oldResponse = { ...response('accepted', 'all'), updated_at: '2026-10-12T10:00:00Z' };

  beforeEach(async () => {
    toastAdd = vi.fn();
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: MessageService, useValue: { add: toastAdd } },
        { provide: LensService, useValue: { activeLens: signal('me') } },
      ],
    });
    await TestBed.compileComponents();
    http = TestBed.inject(HttpTestingController);
    users = TestBed.inject(UserService);
    users.user.set({ sub: 'synthetic-a', username: 'synthetic-viewer', email: 'synthetic@example.com' } as User);
    users.authenticated.set(true);
  });

  afterEach(() => http.verify());

  const mount = (suppliedMeeting = meeting, fetched: MeetingRsvp | null = null) => {
    const fixture = TestBed.createComponent(RsvpButtonGroupComponent);
    fixture.componentRef.setInput('meeting', suppliedMeeting);
    fixture.detectChanges();
    TestBed.tick();
    for (const request of http.match('/api/profile')) request.flush({ profile: {} });
    http.expectOne(`/api/meetings/${MEETING.id}/rsvp/me`).flush(fetched);
    return fixture;
  };

  it('rejects retained, supplied, and fetched history after leave/rejoin on the same control and after remount', () => {
    const fixture = mount({ ...meeting, my_rsvp: oldResponse }, oldResponse);
    const component = fixture.componentInstance;
    component.handleRsvpClick('accepted');
    http.expectOne(`/api/meetings/${MEETING.id}/rsvp`).flush(oldResponse);
    expect(component.selectedResponse()).toBe('accepted');

    users.clearConfirmedMeetingRsvps(MEETING.id, 'synthetic-a', { removed_registrant_ids: ['synthetic-registrant'], remaining_registrant_ids: [] });
    expect(component.selectedResponse()).toBeNull();
    expect(component.responseSaved()).toBe(false);
    const rejoined = { ...meeting, my_rsvp: oldResponse, my_registrant_ids: ['synthetic-new-registration'] };
    fixture.componentRef.setInput('meeting', rejoined);
    fixture.detectChanges();
    TestBed.tick();
    http.expectOne(`/api/meetings/${MEETING.id}/rsvp/me`).flush(oldResponse);
    expect(component.selectedResponse()).toBeNull();
    fixture.destroy();

    const remounted = mount(rejoined, oldResponse);
    expect(remounted.componentInstance.selectedResponse()).toBeNull();
    const newResponse = { ...oldResponse, id: 'synthetic-new-response', registrant_id: 'synthetic-new-registration', response_type: 'maybe' as const };
    remounted.componentInstance.handleRsvpClick('maybe');
    http.expectOne(`/api/meetings/${MEETING.id}/rsvp`).flush(newResponse);
    expect(remounted.componentInstance.selectedResponse()).toBe('maybe');
    remounted.destroy();
  });

  it('keeps a saved answer on a recreated control while the index still returns the previous answer', () => {
    const fixture = mount(meeting, oldResponse);
    fixture.componentInstance.handleRsvpClick('declined');
    http.expectOne(`/api/meetings/${MEETING.id}/rsvp`).flush({ ...oldResponse, response_type: 'declined' });
    expect(fixture.componentInstance.selectedResponse()).toBe('declined');
    fixture.destroy();

    const recreated = mount(meeting, oldResponse);
    expect(recreated.componentInstance.selectedResponse()).toBe('declined');
    recreated.destroy();
  });

  it('shows a successfully saved new-registration answer while supplied and refetched registration metadata is stale', () => {
    const fixture = mount({ ...meeting, my_rsvp: oldResponse }, oldResponse);
    users.clearConfirmedMeetingRsvps(MEETING.id, 'synthetic-a', { removed_registrant_ids: ['synthetic-registrant'], remaining_registrant_ids: [] });
    const newResponse = { ...oldResponse, id: 'synthetic-new-response', registrant_id: 'synthetic-new-registration', response_type: 'maybe' as const };
    fixture.componentInstance.handleRsvpClick('maybe');
    http.expectOne(`/api/meetings/${MEETING.id}/rsvp`).flush(newResponse);
    expect(fixture.componentInstance.selectedResponse()).toBe('maybe');
    let rows: Meeting[] = [];
    const subscription = users.getUserMeetings().subscribe((meetings) => (rows = meetings));
    http.expectOne('/api/user/meetings').flush([{ ...meeting, my_rsvp: oldResponse }]);
    expect(rows[0].my_rsvp?.registrant_id).toBe(newResponse.registrant_id);
    expect(fixture.componentInstance.selectedResponse()).toBe('maybe');
    subscription.unsubscribe();
    fixture.destroy();
  });

  it('does not retain or emit a late acknowledgement from a successfully removed registration', () => {
    const fixture = mount();
    const changed = vi.fn();
    fixture.componentInstance.rsvpChanged.subscribe(changed);
    fixture.componentInstance.handleRsvpClick('accepted');
    const write = http.expectOne(`/api/meetings/${MEETING.id}/rsvp`);

    users.clearConfirmedMeetingRsvps(MEETING.id, 'synthetic-a', { removed_registrant_ids: ['synthetic-registrant'], remaining_registrant_ids: [] });
    write.flush(oldResponse);

    expect(changed).not.toHaveBeenCalled();
    expect(toastAdd).not.toHaveBeenCalled();
    expect(fixture.componentInstance.selectedResponse()).toBeNull();
    expect(fixture.componentInstance.isLoading()).toBe(false);
    let rows: Meeting[] = [];
    const subscription = users.getUserMeetings().subscribe((meetings) => (rows = meetings));
    http.expectOne('/api/user/meetings').flush([{ ...meeting, my_rsvp: null, my_registrant_ids: undefined }]);
    expect(rows[0].my_rsvp).toBeNull();
    subscription.unsubscribe();
    fixture.destroy();
  });

  it('ends an in-flight first response whose registration the removal could not name', () => {
    const publicMeeting = { ...meeting, my_registrant_ids: undefined };
    const fixture = mount(publicMeeting);
    const changed = vi.fn();
    fixture.componentInstance.rsvpChanged.subscribe(changed);
    fixture.componentInstance.handleRsvpClick('accepted');
    const write = http.expectOne(`/api/meetings/${MEETING.id}/rsvp`);

    users.clearConfirmedMeetingRsvps(MEETING.id, 'synthetic-a', { removed_registrant_ids: [], remaining_registrant_ids: [] });
    write.flush(oldResponse);

    expect(changed).not.toHaveBeenCalled();
    expect(fixture.componentInstance.selectedResponse()).toBeNull();
    expect(users.isMeetingRsvpCurrent(oldResponse, publicMeeting, 'synthetic-a')).toBe(false);
    let rows: Meeting[] = [];
    const subscription = users.getUserMeetings().subscribe((meetings) => (rows = meetings));
    http.expectOne('/api/user/meetings').flush([{ ...publicMeeting, my_rsvp: null }]);
    expect(rows[0].my_rsvp).toBeNull();
    subscription.unsubscribe();
    fixture.destroy();
  });

  it('uses the dispatch subject for a late confirmation without emitting it into another viewer', () => {
    const fixture = mount();
    const changed = vi.fn();
    fixture.componentInstance.rsvpChanged.subscribe(changed);
    fixture.componentInstance.handleRsvpClick('accepted');
    const write = http.expectOne(`/api/meetings/${MEETING.id}/rsvp`);
    users.user.set({ sub: 'synthetic-b', username: 'synthetic-viewer', email: 'synthetic@example.com' } as User);
    users.clearConfirmedMeetingRsvps(MEETING.id, 'synthetic-b', { removed_registrant_ids: ['synthetic-registrant'], remaining_registrant_ids: [] });
    fixture.detectChanges();
    TestBed.tick();
    http.expectOne(`/api/meetings/${MEETING.id}/rsvp/me`).flush(null);
    write.flush(oldResponse);

    expect(changed).not.toHaveBeenCalled();
    expect(fixture.componentInstance.selectedResponse()).toBeNull();
    let rows: Meeting[] = [];
    const other = users.getUserMeetings().subscribe((meetings) => (rows = meetings));
    http.expectOne('/api/user/meetings').flush([{ ...meeting, my_rsvp: null }]);
    expect(rows[0].my_rsvp).toBeNull();
    other.unsubscribe();
    users.user.set({ sub: 'synthetic-a', username: 'synthetic-viewer', email: 'synthetic@example.com' } as User);
    const returning = users.getUserMeetings().subscribe((meetings) => (rows = meetings));
    http.expectOne('/api/user/meetings').flush([{ ...meeting, my_rsvp: null }]);
    expect(rows[0].my_rsvp?.response_type).toBe('accepted');
    returning.unsubscribe();
    fixture.destroy();
  });
});
