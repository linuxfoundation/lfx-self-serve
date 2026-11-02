// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Meeting, MeetingHomeRow, MeetingRsvp, MeetingRsvpSubmitError, RsvpScope } from '@lfx-one/shared/interfaces';
import { MeetingService } from '@services/meeting.service';
import { MeetingRsvpService } from '@services/meeting-rsvp.service';
import { UiModalService } from '@shared/uikit/modal/modal.service';
import { UiToastService } from '@shared/uikit/toast/toast.service';
import { of, Subject, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { MeetingRsvpScopeModalComponent } from '../meeting-rsvp-scope-modal/meeting-rsvp-scope-modal.component';
import { MeetingRsvpControlsComponent } from './meeting-rsvp-controls.component';

// Thursday, Oct 1 2026, 09:00 in the runner's local zone.
const START = new Date(2026, 9, 1, 9, 0);
const OCCURRENCE_ID = String(START.getTime() / 1000);

function buildMeeting(overrides: Partial<Meeting> = {}): Meeting {
  return { id: 'synthetic-meeting', title: 'Synthetic sync', invited: true, is_invite_responses_enabled: true, recurrence: null, ...overrides } as Meeting;
}

function buildRsvp(overrides: Partial<MeetingRsvp> = {}): MeetingRsvp {
  return {
    id: 'synthetic-rsvp',
    meeting_id: 'synthetic-meeting',
    registrant_id: 'synthetic-registrant',
    username: 'synthetic-viewer',
    email: 'synthetic@example.com',
    response_type: 'accepted',
    scope: 'all',
    created_at: '2026-09-30T09:00:00Z',
    ...overrides,
  };
}

function buildRow(meeting: Meeting, overrides: Partial<MeetingHomeRow> = {}): MeetingHomeRow {
  return {
    key: meeting.id,
    meeting,
    occurrence: null,
    title: 'Synthetic sync',
    occurrenceId: meeting.recurrence ? OCCURRENCE_ID : null,
    startTime: START.toISOString(),
    durationMinutes: 60,
    myRsvp: null,
    ...overrides,
  };
}

const RECURRING = { recurrence: { type: 2, repeat_interval: 1 } } as Partial<Meeting>;

describe('MeetingRsvpControlsComponent', () => {
  let submit: ReturnType<typeof vi.fn>;
  let openModal: ReturnType<typeof vi.fn>;
  let showToast: ReturnType<typeof vi.fn>;
  let closed: Subject<RsvpScope | undefined>;
  let removed: ReturnType<typeof signal<ReadonlySet<string>>>;

  const render = async (row: MeetingHomeRow): Promise<ComponentFixture<MeetingRsvpControlsComponent>> => {
    const fixture = TestBed.createComponent(MeetingRsvpControlsComponent);
    fixture.componentRef.setInput('row', row);
    await fixture.whenStable();
    return fixture;
  };
  const query = (fixture: ComponentFixture<MeetingRsvpControlsComponent>, testId: string): HTMLElement | null =>
    fixture.nativeElement.querySelector(`[data-testid="${testId}"]`);
  const button = (fixture: ComponentFixture<MeetingRsvpControlsComponent>, testId: string): HTMLButtonElement =>
    query(fixture, testId)?.querySelector('button') as HTMLButtonElement;
  const press = async (fixture: ComponentFixture<MeetingRsvpControlsComponent>, testId: string): Promise<void> => {
    button(fixture, testId).click();
    await fixture.whenStable();
  };

  beforeEach(() => {
    submit = vi.fn((_meeting: Meeting, occurrenceId: string | undefined, response: MeetingRsvp['response_type'], scope: RsvpScope) =>
      of(buildRsvp({ response_type: response, scope, occurrence_id: occurrenceId }))
    );
    closed = new Subject<RsvpScope | undefined>();
    openModal = vi.fn(() => ({ closed, close: () => closed.next(undefined) }));
    showToast = vi.fn();
    removed = signal<ReadonlySet<string>>(new Set());
    TestBed.configureTestingModule({
      providers: [
        { provide: MeetingRsvpService, useValue: { submit$: submit } },
        { provide: MeetingService, useValue: { removedRegistrationMeetingIds: removed } },
        { provide: UiModalService, useValue: { open: openModal } },
        { provide: UiToastService, useValue: { show: showToast } },
      ],
    });
  });

  describe('visibility', () => {
    it('renders nothing when invite responses are disabled', async () => {
      const fixture = await render(buildRow(buildMeeting({ is_invite_responses_enabled: false })));
      expect(query(fixture, 'meetings-home-rsvp')).toBeNull();
    });

    it('renders nothing for a meeting the viewer is not invited to', async () => {
      const fixture = await render(buildRow(buildMeeting({ invited: false })));
      expect(query(fixture, 'meetings-home-rsvp')).toBeNull();
    });

    it('renders nothing once the viewer removed their own registration', async () => {
      removed.set(new Set(['synthetic-meeting']));
      const fixture = await render(buildRow(buildMeeting({ organizer: true })));
      expect(query(fixture, 'meetings-home-rsvp')).toBeNull();
    });
  });

  describe('one-time meeting', () => {
    it('saves straight away for all dates and confirms with a dark toast', async () => {
      const fixture = await render(buildRow(buildMeeting()));

      expect(query(fixture, 'meetings-home-rsvp-accepted')?.textContent?.trim()).toBe('Yes');
      expect(query(fixture, 'meetings-home-rsvp-declined')?.textContent?.trim()).toBe('No');
      expect(query(fixture, 'meetings-home-rsvp-maybe')?.textContent?.trim()).toBe('Maybe');
      await press(fixture, 'meetings-home-rsvp-accepted');

      expect(openModal).not.toHaveBeenCalled();
      expect(submit).toHaveBeenCalledWith(expect.objectContaining({ id: 'synthetic-meeting' }), undefined, 'accepted', 'all');
      expect(showToast).toHaveBeenCalledWith({ variant: 'dark', message: 'Response saved: Going', description: 'Synthetic sync — This meeting' });
    });

    it('shows the saving answer as loading and ignores other answers until the save settles', async () => {
      const pending = new Subject<MeetingRsvp>();
      submit.mockReturnValue(pending);
      const fixture = await render(buildRow(buildMeeting()));

      await press(fixture, 'meetings-home-rsvp-maybe');
      expect(button(fixture, 'meetings-home-rsvp-maybe').getAttribute('aria-busy')).toBe('true');
      expect(button(fixture, 'meetings-home-rsvp-accepted').disabled).toBe(true);
      expect(query(fixture, 'meetings-home-rsvp')?.getAttribute('aria-busy')).toBe('true');

      pending.next(buildRsvp({ response_type: 'maybe' }));
      pending.complete();
      await fixture.whenStable();
      expect(button(fixture, 'meetings-home-rsvp-accepted').disabled).toBe(false);
      expect(submit).toHaveBeenCalledTimes(1);
    });

    it('reports a failure with the error copy and lets the viewer try again', async () => {
      const error: MeetingRsvpSubmitError = { message: 'Only invited users are allowed to RSVP to this meeting.', status: 404 };
      submit.mockReturnValue(throwError(() => error));
      const fixture = await render(buildRow(buildMeeting()));

      await press(fixture, 'meetings-home-rsvp-declined');

      expect(showToast).toHaveBeenCalledWith({
        variant: 'dark',
        message: 'RSVP Failed',
        description: 'Only invited users are allowed to RSVP to this meeting.',
        duration: 5000,
      });
      expect(button(fixture, 'meetings-home-rsvp-accepted').disabled).toBe(false);
    });
  });

  describe('recurring meeting', () => {
    it('asks for the scope and saves with the chosen one', async () => {
      const fixture = await render(buildRow(buildMeeting(RECURRING)));

      await press(fixture, 'meetings-home-rsvp-declined');
      expect(openModal).toHaveBeenCalledWith(MeetingRsvpScopeModalComponent, {
        data: { row: expect.objectContaining({ occurrenceId: OCCURRENCE_ID }), response: 'declined' },
      });
      expect(submit).not.toHaveBeenCalled();

      closed.next('this_and_following');
      expect(submit).toHaveBeenCalledWith(expect.objectContaining({ id: 'synthetic-meeting' }), OCCURRENCE_ID, 'declined', 'this_and_following');
      expect(showToast).toHaveBeenCalledWith({ variant: 'dark', message: 'Response saved: Not going', description: 'Synthetic sync — Oct 1 and following' });
    });

    it('saves nothing when the dialog is cancelled', async () => {
      const fixture = await render(buildRow(buildMeeting(RECURRING)));

      await press(fixture, 'meetings-home-rsvp-accepted');
      closed.next(undefined);

      expect(submit).not.toHaveBeenCalled();
      expect(showToast).not.toHaveBeenCalled();
    });

    it('closes an open dialog without saving when the row goes away', async () => {
      const fixture = await render(buildRow(buildMeeting(RECURRING)));

      await press(fixture, 'meetings-home-rsvp-accepted');
      fixture.destroy();

      expect(submit).not.toHaveBeenCalled();
    });
  });

  describe('answered', () => {
    it('shows the answer as a badge with the dates it covers', async () => {
      const rsvp = buildRsvp({ response_type: 'maybe', scope: 'single', occurrence_id: OCCURRENCE_ID });
      const fixture = await render(buildRow(buildMeeting(RECURRING), { myRsvp: rsvp }));

      expect(query(fixture, 'meetings-home-rsvp-accepted')).toBeNull();
      expect(query(fixture, 'meetings-home-rsvp-status')?.textContent?.trim()).toBe('Maybe');
      expect(query(fixture, 'meetings-home-rsvp-status')?.getAttribute('aria-label')).toBe('Your RSVP: Maybe. Change');
      expect(query(fixture, 'meetings-home-rsvp-scope')?.textContent?.trim()).toBe('Oct 1 only');
    });

    it('has no dates note for a one-time meeting', async () => {
      const fixture = await render(buildRow(buildMeeting(), { myRsvp: buildRsvp() }));

      expect(query(fixture, 'meetings-home-rsvp-status')?.textContent?.trim()).toBe('Going');
      expect(query(fixture, 'meetings-home-rsvp-scope')).toBeNull();
    });

    it('changes the answer from the menu and ignores the current one', async () => {
      const fixture = await render(buildRow(buildMeeting(), { myRsvp: buildRsvp() }));
      const menuItem = (response: string): HTMLElement => document.querySelector(`[data-testid="meetings-home-rsvp-menu-${response}"]`) as HTMLElement;

      (query(fixture, 'meetings-home-rsvp-status') as HTMLButtonElement).click();
      await fixture.whenStable();
      expect(menuItem('accepted').querySelector('[data-testid="ui-menu-item-trailing-icon"]')).not.toBeNull();
      expect(menuItem('declined').querySelector('[data-testid="ui-menu-item-trailing-icon"]')).toBeNull();
      menuItem('accepted').click();
      await fixture.whenStable();
      expect(submit).not.toHaveBeenCalled();

      (query(fixture, 'meetings-home-rsvp-status') as HTMLButtonElement).click();
      await fixture.whenStable();
      menuItem('declined').click();
      await fixture.whenStable();
      expect(submit).toHaveBeenCalledWith(expect.objectContaining({ id: 'synthetic-meeting' }), undefined, 'declined', 'all');
    });
  });
});
