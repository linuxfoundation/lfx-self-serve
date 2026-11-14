// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { CdkMenuTrigger } from '@angular/cdk/menu';
import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { RecurrenceType } from '@lfx-one/shared/enums';
import { Meeting, MeetingHomeRow, MeetingRsvp, MeetingRsvpSubmitError, RsvpScope } from '@lfx-one/shared/interfaces';
import { MeetingService } from '@services/meeting.service';
import { MeetingRsvpService } from '@services/meeting-rsvp.service';
import { UiModalService } from '@shared/uikit/modal/modal.service';
import { UiToastService } from '@shared/uikit/toast/toast.service';
import { defer, of, Subject, throwError } from 'rxjs';
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

const RECURRING: Partial<Meeting> = { recurrence: { type: RecurrenceType.WEEKLY, repeat_interval: 1 } };

describe('MeetingRsvpControlsComponent', () => {
  let submit: ReturnType<typeof vi.fn>;
  let openModal: ReturnType<typeof vi.fn>;
  let showToast: ReturnType<typeof vi.fn>;
  let closed: Subject<RsvpScope | undefined>;
  let removed: ReturnType<typeof signal<ReadonlySet<string>>>;
  let submitting: ReturnType<typeof signal<ReadonlySet<string>>>;

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
    submitting = signal<ReadonlySet<string>>(new Set());
    TestBed.configureTestingModule({
      providers: [
        { provide: MeetingRsvpService, useValue: { submit$: submit, submittingMeetingIds: submitting } },
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

    it('renders nothing while the RSVPs are not loaded', async () => {
      const fixture = await render(buildRow(buildMeeting(), { myRsvp: undefined }));
      expect(query(fixture, 'meetings-home-rsvp')).toBeNull();
    });

    it('renders nothing without a registration to answer for, but keeps the controls when the list is unknown', async () => {
      const fixture = await render(buildRow(buildMeeting({ my_registrant_ids: [] })));
      expect(query(fixture, 'meetings-home-rsvp')).toBeNull();

      fixture.componentRef.setInput('row', buildRow(buildMeeting({ my_registrant_ids: undefined })));
      await fixture.whenStable();
      expect(query(fixture, 'meetings-home-rsvp')).not.toBeNull();
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

      const buttons = Array.from(query(fixture, 'meetings-home-rsvp')?.querySelectorAll('button') ?? []);
      expect(buttons.map((item) => item.textContent?.trim())).toEqual(['Yes', 'Maybe', 'No']);
      expect(buttons.every((item) => item.querySelector('i.fa-light'))).toBe(true);
      expect(button(fixture, 'meetings-home-rsvp-accepted').getAttribute('aria-label')).toBe('RSVP Yes to Synthetic sync');
      await press(fixture, 'meetings-home-rsvp-accepted');

      expect(openModal).not.toHaveBeenCalled();
      expect(submit).toHaveBeenCalledWith(expect.objectContaining({ id: 'synthetic-meeting' }), undefined, 'accepted', 'all');
      expect(showToast).toHaveBeenCalledWith({ variant: 'dark', message: 'Meeting RSVP set to “Going”' });
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

    it('waits while another date of the same series is saving', async () => {
      submitting.set(new Set(['synthetic-meeting']));
      const fixture = await render(buildRow(buildMeeting()));

      expect(button(fixture, 'meetings-home-rsvp-accepted').disabled).toBe(true);
      expect(button(fixture, 'meetings-home-rsvp-maybe').getAttribute('aria-busy')).toBeNull();
    });

    it('moves focus to the status badge when a first answer replaces the buttons', async () => {
      const fixture = await render(buildRow(buildMeeting()));
      submit.mockImplementation(() =>
        defer(() => {
          // The saved answer reaches the row before the next render, as the store's overlay does.
          fixture.componentRef.setInput('row', buildRow(buildMeeting(), { myRsvp: buildRsvp() }));
          return of(buildRsvp());
        })
      );
      document.body.appendChild(fixture.nativeElement);

      button(fixture, 'meetings-home-rsvp-accepted').focus();
      await press(fixture, 'meetings-home-rsvp-accepted');

      expect(document.activeElement).toBe(query(fixture, 'meetings-home-rsvp-status'));
      fixture.nativeElement.remove();
    });

    it('reports a failure with the error copy and lets the viewer try again', async () => {
      const error: MeetingRsvpSubmitError = { message: 'Only invited users are allowed to RSVP to this meeting.', status: 404 };
      submit.mockReturnValue(throwError(() => error));
      const fixture = await render(buildRow(buildMeeting()));

      await press(fixture, 'meetings-home-rsvp-declined');

      expect(showToast).toHaveBeenCalledWith({
        variant: 'error',
        position: 'bottom-center',
        message: 'RSVP Failed',
        description: 'Only invited users are allowed to RSVP to this meeting.',
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
      expect(showToast).toHaveBeenCalledWith({ variant: 'dark', message: 'Meeting RSVP set to “Not going” for this and following occurrences' });
    });

    it('saves nothing when the dialog is cancelled', async () => {
      const fixture = await render(buildRow(buildMeeting(RECURRING)));

      await press(fixture, 'meetings-home-rsvp-accepted');
      closed.next(undefined);

      expect(submit).not.toHaveBeenCalled();
      expect(showToast).not.toHaveBeenCalled();
    });

    it('tells the viewer instead of saving when another date of the series starts saving while the dialog is open', async () => {
      const fixture = await render(buildRow(buildMeeting(RECURRING)));

      await press(fixture, 'meetings-home-rsvp-accepted');
      submitting.set(new Set(['synthetic-meeting']));
      closed.next('all');

      expect(submit).not.toHaveBeenCalled();
      expect(showToast).toHaveBeenCalledWith({
        variant: 'warning',
        position: 'bottom-center',
        message: 'RSVP Not Saved',
        description: 'Another response to this meeting is still saving. Try again.',
        duration: 5000,
      });
    });

    it('closes an open dialog without saving when the row goes away', async () => {
      const fixture = await render(buildRow(buildMeeting(RECURRING)));

      await press(fixture, 'meetings-home-rsvp-accepted');
      fixture.destroy();

      expect(submit).not.toHaveBeenCalled();
    });
  });

  it('lays the answer buttons out in three full-width columns with fullWidth', async () => {
    const fixture = TestBed.createComponent(MeetingRsvpControlsComponent);
    fixture.componentRef.setInput('row', buildRow(buildMeeting(), { myRsvp: null }));
    fixture.componentRef.setInput('fullWidth', true);
    await fixture.whenStable();

    expect(query(fixture, 'meetings-home-rsvp')?.classList).toContain('grid-cols-3');
    expect(query(fixture, 'meetings-home-rsvp-accepted')?.classList).toContain('block');
  });

  describe('answered', () => {
    it('shows the answer as a badge without the dates it covers', async () => {
      const rsvp = buildRsvp({ response_type: 'maybe', scope: 'single', occurrence_id: OCCURRENCE_ID });
      const fixture = await render(buildRow(buildMeeting(RECURRING), { myRsvp: rsvp }));

      expect(query(fixture, 'meetings-home-rsvp-accepted')).toBeNull();
      expect(query(fixture, 'meetings-home-rsvp-status')?.textContent?.trim()).toBe('Maybe');
      expect(query(fixture, 'meetings-home-rsvp-status')?.getAttribute('aria-label')).toBe('Your RSVP: Maybe. Change');
      expect(query(fixture, 'meetings-home-rsvp-scope')).toBeNull();
    });

    it('shows the answer for a one-time meeting', async () => {
      const fixture = await render(buildRow(buildMeeting(), { myRsvp: buildRsvp() }));

      expect(query(fixture, 'meetings-home-rsvp-status')?.textContent?.trim()).toBe('Going');
    });

    it('opens the change menu from the badge end edge', async () => {
      const fixture = await render(buildRow(buildMeeting(), { myRsvp: buildRsvp() }));
      const trigger = fixture.debugElement.query(By.directive(CdkMenuTrigger)).injector.get(CdkMenuTrigger);

      expect(trigger.menuPosition[0]).toEqual({ originX: 'end', originY: 'bottom', overlayX: 'end', overlayY: 'top' });
    });

    it('spans a full-width badge across the container and opens its menu from the start edge', async () => {
      const fixture = TestBed.createComponent(MeetingRsvpControlsComponent);
      fixture.componentRef.setInput('row', buildRow(buildMeeting(), { myRsvp: buildRsvp() }));
      fixture.componentRef.setInput('fullWidth', true);
      await fixture.whenStable();
      const trigger = fixture.debugElement.query(By.directive(CdkMenuTrigger)).injector.get(CdkMenuTrigger);

      expect(query(fixture, 'meetings-home-rsvp')?.classList).toContain('w-full');
      expect(query(fixture, 'meetings-home-rsvp-status')?.querySelector('lfx-ui-badge')?.classList).toContain('w-full');
      expect(trigger.menuPosition[0]).toEqual({ originX: 'start', originY: 'bottom', overlayX: 'start', overlayY: 'top' });
    });

    it('lets a recurring answer be picked again to change the dates it covers', async () => {
      const rsvp = buildRsvp({ response_type: 'accepted', scope: 'single', occurrence_id: OCCURRENCE_ID });
      const fixture = await render(buildRow(buildMeeting(RECURRING), { myRsvp: rsvp }));

      (query(fixture, 'meetings-home-rsvp-status') as HTMLButtonElement).click();
      await fixture.whenStable();
      (document.querySelector('[data-testid="meetings-home-rsvp-menu-accepted"]') as HTMLElement).click();
      await fixture.whenStable();
      expect(openModal).toHaveBeenCalledWith(MeetingRsvpScopeModalComponent, { data: expect.objectContaining({ response: 'accepted' }) });

      closed.next('all');
      expect(submit).toHaveBeenCalledWith(expect.objectContaining({ id: 'synthetic-meeting' }), OCCURRENCE_ID, 'accepted', 'all');
    });

    it('changes a one-time answer from the menu and ignores the current one', async () => {
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
