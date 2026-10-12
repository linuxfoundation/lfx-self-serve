// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, input, output, signal, WritableSignal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import {
  Meeting,
  MeetingRegistrant,
  MeetingRosterRequest,
  MeetingRsvp,
  MeetingSectionVisibility,
  MeetingViewerRole,
  PublicMeetingProject,
  RsvpResponse,
} from '@lfx-one/shared/interfaces';
import { MeetingService } from '@services/meeting.service';
import { UserService } from '@services/user.service';
import { Observable, of, Subject, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { MeetingRegistrantsDisplayComponent } from '../../../components/meeting-registrants-display/meeting-registrants-display.component';
import { MeetingDetailsStateService } from '../../meeting-details-state.service';
import { MeetingPeopleComponent } from './people.component';

@Component({ selector: 'lfx-meeting-registrants-display', template: '<span data-testid="registrants-display-stub"></span>' })
class RegistrantsDisplayStubComponent {
  public readonly meeting = input<unknown>();
  public readonly showAddRegistrant = input(false);
  public readonly openAddFormOnShow = input(false);
  public readonly occurrence = input<unknown>(null);
  public readonly myMeetingRegistrants = input(false);
  public readonly initialRegistrants = input<MeetingRegistrant[] | null>(null);
  public readonly initialRegistrantsLoading = input(false);
  public readonly visible = input(false);
  public readonly refreshRequested = output<number>();
}

type LoadedMeeting = Meeting & { project: PublicMeetingProject };

const registrant = (uid: string, overrides: Partial<MeetingRegistrant> = {}): MeetingRegistrant => ({
  uid,
  meeting_id: 'meeting-1',
  email: `${uid}@vendor-corp.example`,
  first_name: uid.toUpperCase(),
  last_name: 'Person',
  host: false,
  job_title: 'Engineer',
  org_name: 'Vendor Corp',
  occurrence_id: null,
  org_is_member: false,
  org_is_project_member: false,
  avatar_url: null,
  username: uid,
  linkedin_profile: null,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
  type: 'direct',
  invite_accepted: null,
  attended: null,
  rsvp: null,
  ...overrides,
});

const maybeRsvp: MeetingRsvp = {
  id: 'rsvp-1',
  meeting_id: 'meeting-1',
  registrant_id: 'b',
  username: 'b',
  email: 'b@vendor-corp.example',
  response_type: 'maybe',
  scope: 'single',
  created_at: '2026-01-01T00:00:00Z',
};

describe('MeetingPeopleComponent', () => {
  let fixture: ComponentFixture<MeetingPeopleComponent>;
  let meeting: WritableSignal<LoadedMeeting | undefined>;
  let viewerRole: WritableSignal<MeetingViewerRole | null>;
  let rosterRequest: WritableSignal<MeetingRosterRequest | null>;
  let visibleSections: WritableSignal<Partial<MeetingSectionVisibility> | null>;
  let myRsvp: WritableSignal<RsvpResponse | null | undefined>;
  let getMyMeetingRegistrants: ReturnType<typeof vi.fn>;

  const setup = async (response: () => Observable<MeetingRegistrant[]>): Promise<void> => {
    getMyMeetingRegistrants = vi.fn().mockImplementation(response);
    await TestBed.configureTestingModule({
      imports: [MeetingPeopleComponent],
      providers: [
        provideNoopAnimations(),
        { provide: MeetingDetailsStateService, useValue: { meeting, selectedOccurrence: signal(null), viewerRole, rosterRequest, visibleSections, myRsvp } },
        { provide: MeetingService, useValue: { getMyMeetingRegistrants } },
        { provide: UserService, useValue: { viewerUsername: signal('me'), user: signal({ email: 'me@vendor-corp.example' }) } },
      ],
    })
      .overrideComponent(MeetingPeopleComponent, { remove: { imports: [MeetingRegistrantsDisplayComponent] } })
      .overrideComponent(MeetingPeopleComponent, { add: { imports: [RegistrantsDisplayStubComponent] } })
      .compileComponents();

    fixture = TestBed.createComponent(MeetingPeopleComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  };

  beforeEach(() => {
    meeting = signal<LoadedMeeting | undefined>({ id: 'meeting-1', project: {} } as unknown as LoadedMeeting);
    viewerRole = signal<MeetingViewerRole | null>('registrant');
    rosterRequest = signal<MeetingRosterRequest | null>({ meetingId: 'meeting-1', occurrenceId: 'occ-1' });
    visibleSections = signal<Partial<MeetingSectionVisibility> | null>({ people: true, rsvpSummary: true, rsvpAvatarBadges: true });
    myRsvp = signal<RsvpResponse | null | undefined>(undefined);
  });

  const query = (testId: string): HTMLElement | null => fixture.nativeElement.querySelector(`[data-testid="${testId}"]`);
  const text = (testId: string): string => query(testId)?.textContent?.replace(/\s+/g, ' ').trim() ?? '';

  it('fetches the roster with RSVPs for the requested meeting and occurrence', async () => {
    await setup(() => of([registrant('a')]));

    expect(getMyMeetingRegistrants).toHaveBeenCalledWith('meeting-1', true, 'occ-1');
    expect(text('people-section-count')).toBe('1 invited');
  });

  it('lists each row with its role, RSVP chip and state attributes', async () => {
    await setup(() =>
      of([registrant('host', { host: true }), registrant('a', { invite_accepted: true }), registrant('b', { type: 'committee', rsvp: maybeRsvp })])
    );

    const row = query('participant-row-a');
    expect(row?.textContent).toContain('A Person');
    expect(row?.textContent).toContain('Engineer · Vendor Corp');
    expect(row?.textContent).toContain('Accepted');
    expect(row?.getAttribute('data-attendance')).toBe('accepted');
    expect(row?.getAttribute('data-invitation')).toBe('direct');
    expect(query('participant-row-b')?.getAttribute('data-invitation')).toBe('committee');
    expect(query('participant-row-host')?.textContent).toContain('Organizer');
    expect(text('people-section-tally-accepted')).toBe('1 accepted');
    expect(text('people-section-tally-maybe')).toBe('1 maybe');
    expect(text('people-section-tally-pending')).toBe('1 pending');
  });

  // RSVP's hard gate: a meeting created before invite responses shows no RSVP UI at all.
  it('shows no tallies, chips or data-attendance when RSVP tracking is off', async () => {
    visibleSections.set({ people: true, rsvpSummary: false, rsvpAvatarBadges: false });
    await setup(() => of([registrant('a', { invite_accepted: true })]));

    expect(query('people-section-tallies')).toBeNull();
    expect(query('participant-row-a')?.hasAttribute('data-attendance')).toBe(false);
    expect(query('participant-row-a')?.getAttribute('data-invitation')).toBe('direct');
    expect(query('participant-row-a')?.textContent).not.toContain('Accepted');
  });

  it("shows the viewer's just-saved RSVP on their own row", async () => {
    await setup(() => of([registrant('me', { invite_accepted: false })]));
    expect(query('participant-row-me')?.getAttribute('data-attendance')).toBe('declined');

    myRsvp.set('accepted');
    fixture.detectChanges();

    expect(query('participant-row-me')?.getAttribute('data-attendance')).toBe('accepted');
  });

  it('lists the first five, and offers the whole list past that', async () => {
    await setup(() => of(['a', 'b', 'c', 'd', 'e', 'f', 'g'].map((uid) => registrant(uid))));

    expect(fixture.nativeElement.querySelectorAll('[data-testid^="participant-row-"]').length).toBe(5);
    expect(text('people-section-view-all')).toBe('View all 7 guests');
  });

  it("calls a committee meeting's roster its members", async () => {
    meeting.set({ id: 'meeting-1', project: {}, committees: [{ uid: 'c1' }] } as unknown as LoadedMeeting);
    await setup(() => of(['a', 'b', 'c', 'd', 'e', 'f'].map((uid) => registrant(uid))));

    expect(text('people-section-view-all')).toBe('View all 6 members');

    query('people-section-view-all')?.click();
    fixture.detectChanges();
    await fixture.whenStable();
    const title = document.body.querySelector('[data-testid="people-drawer-title"]');
    expect(title?.textContent?.trim()).toBe('Meeting Members');
  });

  it('shows a loading state, then an error with a retry that refetches', async () => {
    const pending$ = new Subject<MeetingRegistrant[]>();
    let calls = 0;
    await setup(() => {
      calls++;
      return calls === 1 ? pending$ : of([registrant('a')]);
    });
    expect(query('people-section-loading')).not.toBeNull();

    pending$.error(new Error('boom'));
    fixture.detectChanges();
    expect(query('people-section-error')).not.toBeNull();

    query('people-section-retry')?.click();
    fixture.detectChanges();
    expect(query('people-section-error')).toBeNull();
    expect(query('participant-row-a')).not.toBeNull();
  });

  it('keeps the rows it has when a refetch fails', async () => {
    let calls = 0;
    await setup(() => {
      calls++;
      return calls === 1 ? of([registrant('a')]) : throwError(() => new Error('boom'));
    });

    fixture.componentInstance.onRosterChanged(-1);
    fixture.detectChanges();

    expect(query('people-section-error')).toBeNull();
    expect(query('participant-row-a')).not.toBeNull();
  });

  it('says so when nobody has been invited', async () => {
    await setup(() => of([]));

    expect(text('people-section-empty')).toBe('No guests have been invited to this meeting yet.');
    expect(query('people-section-count')).toBeNull();
  });

  it('offers Add guest to organizers only, opening the guest list on its add form', async () => {
    await setup(() => of([registrant('a')]));
    expect(query('people-section-add')).toBeNull();

    viewerRole.set('organizer');
    fixture.detectChanges();
    query('people-section-add')?.click();
    fixture.detectChanges();
    await fixture.whenStable();

    const display = fixture.debugElement.query((el) => el.componentInstance instanceof RegistrantsDisplayStubComponent)?.componentInstance as
      | RegistrantsDisplayStubComponent
      | undefined;
    expect(display?.showAddRegistrant()).toBe(true);
    expect(display?.openAddFormOnShow()).toBe(true);
    expect(display?.visible()).toBe(true);
    expect(display?.initialRegistrants()?.map((r) => r.uid)).toEqual(['a']);
  });

  it('refetches the roster when the guest list adds or removes someone', async () => {
    await setup(() => of([registrant('a')]));
    getMyMeetingRegistrants.mockClear();

    fixture.componentInstance.onRosterChanged(-1);
    fixture.detectChanges();

    expect(getMyMeetingRegistrants).toHaveBeenCalledTimes(1);
  });

  // The query service indexes added guests after the add returns, as V1's join page pads for.
  it('counts added guests until the roster catches up with them', async () => {
    let roster = [registrant('a'), registrant('b')];
    await setup(() => of(roster));
    expect(text('people-section-count')).toBe('2 invited');

    fixture.componentInstance.onRosterChanged(2);
    fixture.detectChanges();
    expect(text('people-section-count')).toBe('4 invited');

    roster = [registrant('a'), registrant('b'), registrant('c'), registrant('d')];
    fixture.componentInstance.retry();
    fixture.detectChanges();
    expect(text('people-section-count')).toBe('4 invited');
  });

  it('says added guests are on their way rather than that nobody is invited', async () => {
    await setup(() => of([]));
    expect(query('people-section-empty')).not.toBeNull();

    fixture.componentInstance.onRosterChanged(1);
    fixture.detectChanges();

    expect(text('people-section-count')).toBe('1 invited');
    expect(query('people-section-empty')).toBeNull();
    expect(text('people-section-indexing')).toBe('The guests you added will appear here shortly.');
  });

  it('opens the drawer as a named dialog, focuses its title, and hands focus back on close', async () => {
    await setup(() => of([registrant('a')]));
    document.body.appendChild(fixture.nativeElement);
    const trigger = query('people-section-view-all') as HTMLButtonElement;

    trigger.focus();
    trigger.click();
    fixture.detectChanges();
    await fixture.whenStable();

    const dialog = document.body.querySelector('[role="dialog"][aria-modal="true"]');
    expect(dialog?.getAttribute('aria-labelledby')).toBe('people-drawer-title');
    expect(document.activeElement?.id).toBe('people-drawer-title');

    fixture.componentInstance.closeDrawer();
    fixture.detectChanges();
    await fixture.whenStable();

    expect(document.activeElement).toBe(trigger);
    fixture.nativeElement.remove();
  });

  it('offers no Add guest over a roster that failed to load', async () => {
    viewerRole.set('organizer');
    await setup(() => throwError(() => new Error('boom')));

    expect(query('people-section-error')).not.toBeNull();
    expect(query('people-section-add')).toBeNull();
  });
});
