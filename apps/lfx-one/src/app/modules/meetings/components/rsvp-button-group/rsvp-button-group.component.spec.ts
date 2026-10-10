// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Meeting, MeetingRsvp, RsvpResponse, RsvpScope, User } from '@lfx-one/shared/interfaces';
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

  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-10T10:00:00Z'));
    toastAdd = vi.fn();
    dialogClose = new Subject();
    dialogOpen = vi.fn(() => ({ onClose: dialogClose }));
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        {
          provide: UserService,
          useValue: {
            user: signal({ username: 'synthetic-viewer', email: 'synthetic@example.com' } as User),
            authenticated: signal(true),
          },
        },
        { provide: MessageService, useValue: { add: toastAdd } },
        { provide: DialogService, useValue: { open: dialogOpen } },
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
    fixture.detectChanges();
    const host = fixture.nativeElement as HTMLElement;
    const changeResponse = host.querySelector<HTMLButtonElement>('[data-testid="meeting-rsvp-change-response"]')!;
    const yesButton = host.querySelector<HTMLButtonElement>('[data-testid="meeting-rsvp-button-yes"]')!;
    const focus = vi.spyOn(yesButton, 'focus');
    changeResponse.click();
    expect(focus).toHaveBeenCalledTimes(1);
    http.expectNone(`/api/meetings/${MEETING.id}/rsvp`);
  });

  it('keeps a single decline on its date and preserves the prior all-dates response on another date', async () => {
    const fixture = await mount();
    flushRead(null);
    const component = fixture.componentInstance;
    component.handleRsvpClick('accepted');
    dialogClose.next({ confirmed: true, scope: 'all' });
    const allWrite = http.expectOne(`/api/meetings/${MEETING.id}/rsvp`);
    expect(allWrite.request.body).toEqual({ response: 'accepted', scope: 'all', email: 'synthetic@example.com' });
    allWrite.flush(response('accepted', 'all'));

    component.handleRsvpClick('declined');
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

  it('does not submit a modal response after the displayed date changed', async () => {
    const fixture = await mount();
    flushRead(null);
    fixture.componentInstance.handleRsvpClick('declined');
    fixture.componentRef.setInput('occurrenceId', SECOND_DATE);
    fixture.detectChanges();
    TestBed.tick();
    flushRead(null, SECOND_DATE);
    dialogClose.next({ confirmed: true, scope: 'single' });
    http.expectNone(`/api/meetings/${MEETING.id}/rsvp`);
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
