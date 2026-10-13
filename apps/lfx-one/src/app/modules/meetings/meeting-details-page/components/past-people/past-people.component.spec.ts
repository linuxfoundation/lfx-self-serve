// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpErrorResponse } from '@angular/common/http';
import { signal, WritableSignal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Meeting, PublicMeetingProject, PublicPastMeetingRoster } from '@lfx-one/shared/interfaces';
import { MeetingService } from '@services/meeting.service';
import { Observable, of, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { MeetingDetailsStateService } from '../../meeting-details-state.service';
import { MeetingPastPeopleComponent } from './past-people.component';

type LoadedMeeting = Meeting & { project: PublicMeetingProject };

const PAST_ID = 'meeting-1-1700000000000';

const person = (uid: string, invited: boolean, attended: boolean) => ({
  uid,
  first_name: uid,
  last_name: 'Example',
  org_name: 'Example Org',
  is_invited: invited,
  is_attended: attended,
});

const roster = (overrides: Partial<PublicPastMeetingRoster> = {}): PublicPastMeetingRoster => ({
  participants: [person('ada', true, true), person('grace', true, false), person('walk-in', false, true)],
  unidentified_attendees: 0,
  attendance: { participant_count: 4, attended_count: 3, individual_registrants_count: 2 },
  ...overrides,
});

/** E4-05: the V2 past roster, from the public roster route (§ Public roster fields only). */
describe('MeetingPastPeopleComponent', () => {
  let fixture: ComponentFixture<MeetingPastPeopleComponent>;
  let meeting: WritableSignal<LoadedMeeting | undefined>;
  let loadedViaPastMeetingId: WritableSignal<boolean>;
  let matchesRoute: WritableSignal<boolean>;
  let getPublicPastMeetingRoster: ReturnType<typeof vi.fn>;

  const setup = async (read: () => Observable<PublicPastMeetingRoster>): Promise<void> => {
    getPublicPastMeetingRoster.mockImplementation(read);
    await TestBed.configureTestingModule({
      imports: [MeetingPastPeopleComponent],
      providers: [
        {
          provide: MeetingDetailsStateService,
          useValue: { meeting, loadedViaPastMeetingId, matchesRoute, signInHref: signal('/login?returnTo=x') },
        },
        { provide: MeetingService, useValue: { getPublicPastMeetingRoster } },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(MeetingPastPeopleComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  };

  beforeEach(() => {
    // A past payload can carry the series id in `id` and the occurrence in `meeting_and_occurrence_id`.
    meeting = signal<LoadedMeeting | undefined>({
      id: 'meeting-1',
      meeting_and_occurrence_id: PAST_ID,
      title: 'Weekly Sync',
      project: {},
    } as unknown as LoadedMeeting);
    loadedViaPastMeetingId = signal(true);
    matchesRoute = signal(true);
    getPublicPastMeetingRoster = vi.fn();
  });

  const query = (testId: string): HTMLElement | null => fixture.nativeElement.querySelector(`[data-testid="${testId}"]`);
  const rowUids = (): string[] =>
    Array.from(fixture.nativeElement.querySelectorAll('[data-testid^="participant-row-"]')).map((el) =>
      (el as HTMLElement).getAttribute('data-testid')!.replace('participant-row-', '')
    );
  const click = (testId: string): void => {
    query(testId)?.click();
    fixture.detectChanges();
  };

  it("reads the public roster by the occurrence's composite id", async () => {
    await setup(() => of(roster()));

    expect(getPublicPastMeetingRoster).toHaveBeenCalledWith(PAST_ID);
  });

  it("shows the admin page's figures from the shared helper, over every participant", async () => {
    await setup(() => of(roster()));

    expect(query('people-past-rate')?.textContent?.trim()).toBe('75%');
    expect(query('people-past-attended')?.textContent).toContain('3 of 4 attended');
    expect(query('people-past-absent')?.textContent).toContain('1 absent');
    expect(query('people-past-rate-bar')?.getAttribute('data-tone')).toBe('high');
  });

  it('shows a real zero without a rate or a bar', async () => {
    await setup(() => of(roster({ participants: [], attendance: { participant_count: 0, attended_count: 0, individual_registrants_count: 0 } })));

    expect(query('people-past-rate')?.textContent?.trim()).toBe('—');
    expect(query('people-past-rate-bar')).toBeNull();
    expect(query('people-section-empty')).not.toBeNull();
  });

  it('marks each row attended and invited, and shows no email or job title', async () => {
    await setup(() => of(roster()));

    const walkIn = query('participant-row-walk-in');
    expect(walkIn?.getAttribute('data-attended')).toBe('true');
    expect(walkIn?.getAttribute('data-invited')).toBe('false');
    expect(walkIn?.textContent).toContain('Not invited');
    expect(query('participant-row-grace')?.textContent).toContain('Absent');
    expect(fixture.nativeElement.textContent).not.toContain('@');
  });

  it('filters by invitation and by attendance, each on its own axis', async () => {
    await setup(() => of(roster()));

    click('people-past-filter-invitation-not-invited');
    expect(rowUids()).toEqual(['walk-in']);
    expect(query('people-past-filter-invitation-not-invited')?.getAttribute('aria-pressed')).toBe('true');

    click('people-past-filter-invitation-all');
    click('people-past-filter-attendance-absent');
    expect(rowUids()).toEqual(['grace']);

    click('people-past-filter-invitation-not-invited');
    expect(query('people-past-filter-empty')).not.toBeNull();
  });

  it('shows the first rows, then all of them on request, with one toggle that keeps focus', async () => {
    const many = Array.from({ length: 7 }, (_, i) => person(`p${i}`, true, true));
    await setup(() => of(roster({ participants: many, attendance: { participant_count: 7, attended_count: 7, individual_registrants_count: 7 } })));

    expect(rowUids()).toHaveLength(5);
    expect(query('people-section-view-all')?.textContent).toContain('Show all 7');
    expect(query('people-section-view-all')?.getAttribute('aria-expanded')).toBe('false');
    expect(query('people-past-status')?.textContent).toContain('Showing 5 of 7 people.');

    click('people-section-view-all');
    expect(rowUids()).toHaveLength(7);
    // The toggle stays in place (focus is not lost) and now collapses the list.
    expect(query('people-section-view-all')?.textContent).toContain('Show fewer');
    expect(query('people-section-view-all')?.getAttribute('aria-expanded')).toBe('true');
    expect(query('people-past-status')?.textContent).toContain('Showing 7 of 7 people.');

    click('people-section-view-all');
    expect(rowUids()).toHaveLength(5);
  });

  it('announces an empty filter result in the status line', async () => {
    await setup(() => of(roster()));

    click('people-past-filter-invitation-not-invited');
    click('people-past-filter-attendance-absent');

    expect(query('people-past-status')?.textContent).toContain('Nobody matches these filters.');
    expect(query('people-section-list')?.getAttribute('aria-live')).toBeFalsy();
  });

  // N-02: attendees whose identity is not verified are counted, never named.
  it('counts the attendees it does not list', async () => {
    await setup(() => of(roster({ unidentified_attendees: 2 })));

    expect(query('people-past-unidentified')?.textContent).toContain('2 other attendees');
  });

  // N-02: the rate counts unverified attendees, so the figures say how many there are.
  it('says how many of the attendees are unverified, and nothing when none are or the count is absent', async () => {
    await setup(() => of(roster({ attendance: { participant_count: 4, attended_count: 3, individual_registrants_count: 2, unverified_attended_count: 2 } })));
    expect(query('people-past-unverified')?.textContent).toContain('2 unverified');
  });

  it.each([0, undefined])('shows no unverified line for a count of %s', async (unverified) => {
    await setup(() =>
      of(roster({ attendance: { participant_count: 4, attended_count: 3, individual_registrants_count: 2, unverified_attended_count: unverified } }))
    );
    expect(query('people-past-unverified')).toBeNull();
  });

  it.each([
    [403, 'people-section-no-access'],
    [401, 'people-section-sign-in'],
  ])('maps a %i to its own state', async (status, testId) => {
    await setup(() => throwError(() => new HttpErrorResponse({ status })));

    expect(query(testId)).not.toBeNull();
    expect(query('people-section-error')).toBeNull();
  });

  it('offers Try again on any other failure, and reads again', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await setup(() => throwError(() => new HttpErrorResponse({ status: 500 })));

    expect(query('people-section-error')).not.toBeNull();

    getPublicPastMeetingRoster.mockReturnValue(of(roster()));
    click('people-section-retry');
    await fixture.whenStable();
    fixture.detectChanges();

    expect(getPublicPastMeetingRoster).toHaveBeenCalledTimes(2);
    expect(rowUids()).toHaveLength(3);
  });

  it('reads nothing for a meeting held over from the previous route', async () => {
    matchesRoute.set(false);
    await setup(() => of(roster()));

    expect(getPublicPastMeetingRoster).not.toHaveBeenCalled();
    expect(query('people-section-loading')).not.toBeNull();
  });

  it('reads nothing until the occurrence record is loaded', async () => {
    loadedViaPastMeetingId.set(false);
    await setup(() => of(roster()));

    expect(getPublicPastMeetingRoster).not.toHaveBeenCalled();
    expect(query('people-section-loading')).not.toBeNull();
  });
});
