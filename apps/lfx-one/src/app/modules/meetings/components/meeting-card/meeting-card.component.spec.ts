// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { Meeting, MeetingOccurrence } from '@lfx-one/shared/interfaces';
import { MeetingComposerService } from '@app/modules/meetings/meeting-composer/meeting-composer.service';
import { FeatureFlagService } from '@services/feature-flag.service';
import { MeetingService } from '@services/meeting.service';
import { ProjectService } from '@services/project.service';
import { UserService } from '@services/user.service';
import { ConfirmationService, MessageService } from 'primeng/api';
import { DialogService } from 'primeng/dynamicdialog';
import { Observable, of, Subject, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { MeetingCardComponent } from './meeting-card.component';

const MEETING = { id: 'meeting-1', project_uid: 'project-1', project_slug: 'acme', organizer: true } as Meeting;

/**
 * Covers the edit-permission re-check the edit button runs before opening the composer.
 * @description `meeting().organizer` is a snapshot of what the list payload said when the card
 * rendered, so an organizer whose access was revoked since then still sees an edit button. Opening
 * the composer on that stale flag walks the organizer through a whole edit that upstream will reject
 * on save, so the card re-asks before opening — of the meeting itself, which is the object the API's
 * own guard is evaluated against. No `ProjectContextService` is provided below, so a probe that went
 * back to project permissions instead would fail to inject rather than quietly pass.
 */
describe('MeetingCardComponent — edit-access re-check', () => {
  let composerOpen: ReturnType<typeof vi.fn>;
  let toastAdd: ReturnType<typeof vi.fn>;
  let getMeetingDetail: ReturnType<typeof vi.fn>;
  let getMeeting: ReturnType<typeof vi.fn>;
  let navigate: ReturnType<typeof vi.fn>;
  /**
   * `MEETING_V2_ENABLED_FLAG`, stated per test.
   * @description The probe below runs on both sides of the flag — it is a permission re-check, not a
   * v2 feature — but only the flag-on branch opens the composer; with it off the same allowed probe
   * navigates to the pre-v2 editor instead. Both branches are covered, so each case says which one
   * it is rather than inheriting a default from the real service (which answers `false` here).
   */
  const meetingsV2Enabled = signal(true);

  /** Mounts the card over `meeting` with an empty template — this suite exercises the handler, not the markup. */
  async function mount(meeting: Meeting = MEETING, pinned: MeetingOccurrence | null = null): Promise<MeetingCardComponent> {
    TestBed.configureTestingModule({
      providers: [
        { provide: UserService, useValue: { user: signal(null), authenticated: signal(false) } },
        { provide: ProjectService, useValue: { project: signal(null) } },
        { provide: MeetingComposerService, useValue: { open: composerOpen } },
        { provide: FeatureFlagService, useValue: { getBooleanFlag: () => meetingsV2Enabled } },
        { provide: MessageService, useValue: { add: toastAdd } },
        { provide: Router, useValue: { navigate } },
        { provide: ConfirmationService, useValue: {} },
        { provide: DialogService, useValue: { open: vi.fn() } },
        {
          provide: MeetingService,
          useValue: {
            getMeetingDetail,
            getMeeting,
            getMeetingAttachments: vi.fn().mockReturnValue(of([])),
            getPastMeetingAttachments: vi.fn().mockReturnValue(of([])),
            getPublicMeetingJoinUrl: vi.fn().mockReturnValue(of({ link: '' })),
          },
        },
      ],
    });
    // Empty template: the 512-line card markup mounts a dozen child components that have nothing to
    // do with this handler. providers: [] drops the component's own ConfirmationService so the stub
    // above is the one injected.
    TestBed.overrideComponent(MeetingCardComponent, { set: { template: '', imports: [], providers: [] } });
    await TestBed.compileComponents();

    const fixture = TestBed.createComponent(MeetingCardComponent);
    fixture.componentRef.setInput('meetingInput', meeting);
    fixture.componentRef.setInput('occurrenceInput', pinned);
    fixture.detectChanges();

    return fixture.componentInstance;
  }

  beforeEach(() => {
    meetingsV2Enabled.set(true);
    composerOpen = vi.fn();
    toastAdd = vi.fn();
    navigate = vi.fn();
    getMeetingDetail = vi.fn().mockReturnValue(of({ ...MEETING, organizer: true }));
    getMeeting = vi.fn().mockReturnValue(of(MEETING));
  });

  it('opens the composer once a fresh read still reports the viewer as organizer', async () => {
    const component = await mount();

    component.onEditMeeting();

    // `skipCache` is the whole point: the cached payload is the one the stale flag came from.
    expect(getMeetingDetail).toHaveBeenCalledWith('meeting-1', { skipCache: true });
    expect(composerOpen).toHaveBeenCalledWith({ mode: 'edit', meetingUid: 'meeting-1', projectUid: 'project-1' });
    expect(toastAdd).not.toHaveBeenCalled();
  });

  it('refuses to open the composer for an organizer whose access has since been revoked', async () => {
    getMeetingDetail.mockReturnValue(of({ ...MEETING, organizer: false }));
    const component = await mount();

    component.onEditMeeting();

    // The stale `organizer: true` on the card is exactly the case this exists for: the edit would be
    // rejected on save, after the organizer had already redone the work.
    expect(composerOpen).not.toHaveBeenCalled();
    expect(toastAdd).toHaveBeenCalledWith(expect.objectContaining({ severity: 'warn', summary: 'Editing unavailable' }));
  });

  it('opens for an organizer the meeting grants but no project permission would', async () => {
    // A committee writer inherits `organizer` on the meeting while holding nothing at project level.
    // Re-deriving the answer from the project denied exactly this person an edit the API allows.
    getMeetingDetail.mockReturnValue(of({ id: 'meeting-1', organizer: true } as Meeting));
    const component = await mount({ id: 'meeting-1', organizer: true } as Meeting);

    component.onEditMeeting();

    expect(composerOpen).toHaveBeenCalledWith({ mode: 'edit', meetingUid: 'meeting-1', projectUid: undefined });
    expect(toastAdd).not.toHaveBeenCalled();
  });

  it('says the check failed rather than claiming the permission was revoked', async () => {
    getMeetingDetail.mockReturnValue(throwError(() => new Error('network')));
    const component = await mount();

    component.onEditMeeting();

    expect(composerOpen).not.toHaveBeenCalled();
    expect(toastAdd).toHaveBeenCalledWith(expect.objectContaining({ severity: 'warn', summary: 'Could not open the editor' }));
    expect(component.checkingEditAccess()).toBe(false);
  });

  it('holds the button disabled for the length of the probe and ignores a second click', async () => {
    const probe = new Subject<Meeting>();
    getMeetingDetail.mockReturnValue(probe as unknown as Observable<Meeting>);
    const component = await mount();

    component.onEditMeeting();

    expect(component.checkingEditAccess()).toBe(true);

    // A second click while the first probe is in flight must not queue a second request — otherwise
    // two composers race to open over the same meeting.
    component.onEditMeeting();
    expect(getMeetingDetail).toHaveBeenCalledTimes(1);

    probe.next({ ...MEETING, organizer: true });
    probe.complete();

    expect(component.checkingEditAccess()).toBe(false);
    expect(composerOpen).toHaveBeenCalledTimes(1);
  });

  it('releases the button after a denied probe so the organizer can retry', async () => {
    getMeetingDetail.mockReturnValue(of({ ...MEETING, organizer: false }));
    const component = await mount();

    component.onEditMeeting();

    expect(component.checkingEditAccess()).toBe(false);
  });

  it('navigates to the pre-v2 editor instead of the composer while the flag is off', async () => {
    meetingsV2Enabled.set(false);
    const component = await mount({ ...MEETING, is_foundation: false } as Meeting);

    component.onEditMeeting();

    // The pre-v2 editor is a page, not an overlay, so the context the composer would have been
    // handed as arguments has to travel in the URL instead: `project` is what `writerGuard` resolves
    // write access from, and the tier picks the lensed path.
    expect(navigate).toHaveBeenCalledWith(['/', 'project', 'meetings', 'meeting-1', 'edit'], { queryParams: { project: 'acme' } });
    expect(composerOpen).not.toHaveBeenCalled();
  });

  it('carries the group through to the pre-v2 editor for a committee-scoped meeting', async () => {
    meetingsV2Enabled.set(false);
    const meeting = { ...MEETING, is_foundation: true, committees: [{ uid: 'committee-1' }] } as Meeting;
    getMeetingDetail.mockReturnValue(of({ ...meeting, organizer: true }));
    const component = await mount(meeting);

    component.onEditMeeting();

    expect(navigate).toHaveBeenCalledWith(['/', 'foundation', 'meetings', 'meeting-1', 'edit'], {
      queryParams: { project: 'acme', committee_uid: 'committee-1' },
    });
  });

  it('falls back to the flat edit path when the meeting tier is unenriched', async () => {
    meetingsV2Enabled.set(false);
    const component = await mount();

    component.onEditMeeting();

    // `is_foundation` absent means the list payload never said which tier this meeting belongs to;
    // the flat path exists so the redirect guard can work it out rather than guessing wrong here.
    expect(navigate).toHaveBeenCalledWith(['/meetings', 'meeting-1', 'edit'], { queryParams: { project: 'acme' } });
  });

  describe('recurring meetings', () => {
    const OCCURRENCE = { occurrence_id: '1893456000', start_time: '2030-01-01T00:00:00.000Z', duration: 30 };
    const RECURRING = { ...MEETING, recurrence: { type: 2, repeat_interval: 1 }, occurrences: [OCCURRENCE] } as unknown as Meeting;

    let dialogOpen: ReturnType<typeof vi.fn>;
    let dialogResults: Subject<unknown>[];

    /** Mounts over a recurring meeting and makes each `dialogService.open` hand back its own close stream. */
    async function mountRecurring(pinned: MeetingOccurrence | null = null): Promise<MeetingCardComponent> {
      getMeetingDetail.mockReturnValue(of({ ...RECURRING, organizer: true }));
      dialogResults = [];
      dialogOpen = vi.fn(() => {
        const onClose = new Subject<unknown>();
        dialogResults.push(onClose);
        return { onClose };
      });
      TestBed.overrideProvider(DialogService, { useValue: { open: dialogOpen } });
      return mount(RECURRING, pinned);
    }

    it('asks which scope to edit before opening any editor', async () => {
      const component = await mountRecurring();

      component.onEditMeeting();

      expect(dialogOpen).toHaveBeenCalledTimes(1);
      expect(dialogOpen.mock.calls[0][1].data).toEqual(expect.objectContaining({ occurrence: expect.objectContaining({ occurrence_id: '1893456000' }) }));
      expect(composerOpen).not.toHaveBeenCalled();
    });

    it('opens the series editor when the organizer picks the whole series', async () => {
      const component = await mountRecurring();

      component.onEditMeeting();
      dialogResults[0].next({ proceed: true, scope: 'series' });

      expect(composerOpen).toHaveBeenCalledWith({ mode: 'edit', meetingUid: 'meeting-1', projectUid: 'project-1' });
      expect(dialogOpen).toHaveBeenCalledTimes(1);
    });

    it('opens the reschedule dialog for that occurrence when the organizer picks only this one', async () => {
      const component = await mountRecurring();
      const refreshed = vi.fn();
      component.meetingDeleted.subscribe(refreshed);

      component.onEditMeeting();
      dialogResults[0].next({ proceed: true, scope: 'occurrence' });

      expect(composerOpen).not.toHaveBeenCalled();
      expect(dialogOpen).toHaveBeenCalledTimes(2);
      expect(dialogOpen.mock.calls[1][1].data).toEqual(expect.objectContaining({ occurrence: expect.objectContaining({ occurrence_id: '1893456000' }) }));

      const moved = { ...OCCURRENCE, occurrence_id: '1893542400', start_time: '2030-01-02T00:00:00.000Z' };
      getMeeting.mockReturnValue(of({ ...RECURRING, occurrences: [moved] }));
      dialogResults[1].next({ confirmed: true, start_time: '2030-01-02T00:00:00.000Z' });

      expect(toastAdd).toHaveBeenCalledWith(expect.objectContaining({ severity: 'success', summary: 'Occurrence rescheduled' }));
      expect(refreshed).toHaveBeenCalledTimes(1);
      // A host that never binds `meetingDeleted` (the committee meetings list) still sees the new time.
      expect(getMeeting).toHaveBeenCalledWith('meeting-1');
      expect(component.currentOccurrence()?.occurrence_id).toBe('1893542400');
    });

    it('still finds a pinned occurrence whose id was written in milliseconds', async () => {
      const component = await mountRecurring({ ...OCCURRENCE, occurrence_id: '1893456000000' } as MeetingOccurrence);

      component.onEditMeeting();

      expect(toastAdd).not.toHaveBeenCalled();
      expect(dialogOpen).toHaveBeenCalledTimes(1);
      expect(dialogOpen.mock.calls[0][1].data.occurrence.occurrence_id).toBe('1893456000');
    });

    it('takes the shown occurrence values from the fresh read, not the list payload the card rendered with', async () => {
      const component = await mountRecurring();
      getMeetingDetail.mockReturnValue(of({ ...RECURRING, organizer: true, occurrences: [{ ...OCCURRENCE, duration: 45 }] }));

      component.onEditMeeting();

      expect(dialogOpen.mock.calls[0][1].data).toEqual(
        expect.objectContaining({ occurrence: expect.objectContaining({ occurrence_id: '1893456000', duration: 45 }) })
      );
    });

    it('refreshes instead of retargeting a later slot when the shown occurrence was cancelled in another tab', async () => {
      const later = { occurrence_id: '1894060800', start_time: '2030-01-08T00:00:00.000Z', duration: 30 };
      const component = await mountRecurring();
      const refreshed = vi.fn();
      component.meetingDeleted.subscribe(refreshed);
      getMeetingDetail.mockReturnValue(of({ ...RECURRING, organizer: true, occurrences: [OCCURRENCE, later], cancelled_occurrences: ['1893456000'] }));

      component.onEditMeeting();

      expect(dialogOpen).not.toHaveBeenCalled();
      expect(toastAdd).toHaveBeenCalledWith(expect.objectContaining({ severity: 'warn', summary: 'Occurrence changed' }));
      expect(refreshed).toHaveBeenCalledTimes(1);
    });

    it('shows the occurrence duration rather than the series duration', async () => {
      const component = await mount({ ...RECURRING, duration: 60, occurrences: [{ ...OCCURRENCE, duration: 30 }] } as unknown as Meeting);

      expect(component.meetingDuration()).toBe(30);
    });

    it('hands both dialogs the fresh meeting, so a changed series timezone is the one the form uses', async () => {
      const component = await mountRecurring();
      getMeetingDetail.mockReturnValue(of({ ...RECURRING, organizer: true, timezone: 'America/New_York' }));

      component.onEditMeeting();
      dialogResults[0].next({ proceed: true, scope: 'occurrence' });

      expect(dialogOpen.mock.calls[0][1].data.meeting.timezone).toBe('America/New_York');
      expect(dialogOpen.mock.calls[1][1].data.meeting.timezone).toBe('America/New_York');
    });

    it('refreshes instead of opening a ghost slot when the pinned occurrence is gone from the fresh read', async () => {
      // Parent pinned this card to an occurrence another organizer has since moved.
      const component = await mountRecurring(OCCURRENCE as MeetingOccurrence);
      const refreshed = vi.fn();
      component.meetingDeleted.subscribe(refreshed);
      getMeetingDetail.mockReturnValue(of({ ...RECURRING, organizer: true, occurrences: [{ ...OCCURRENCE, occurrence_id: '1893542400' }] }));

      component.onEditMeeting();

      expect(dialogOpen).not.toHaveBeenCalled();
      expect(toastAdd).toHaveBeenCalledWith(expect.objectContaining({ severity: 'warn', summary: 'Occurrence changed' }));
      expect(refreshed).toHaveBeenCalledTimes(1);
    });

    it('does nothing when the scope dialog is dismissed', async () => {
      const component = await mountRecurring();

      component.onEditMeeting();
      dialogResults[0].next(undefined);

      expect(composerOpen).not.toHaveBeenCalled();
      expect(dialogOpen).toHaveBeenCalledTimes(1);
    });
  });

  it('still re-checks access before the pre-v2 editor, and still refuses a revoked organizer', async () => {
    meetingsV2Enabled.set(false);
    getMeetingDetail.mockReturnValue(of({ ...MEETING, organizer: false }));
    const component = await mount();

    component.onEditMeeting();

    // Turning the flag off must not turn the permission re-check off with it — the stale
    // `organizer: true` on the card reaches the pre-v2 editor exactly the same way.
    expect(getMeetingDetail).toHaveBeenCalledWith('meeting-1', { skipCache: true });
    expect(navigate).not.toHaveBeenCalled();
    expect(toastAdd).toHaveBeenCalledWith(expect.objectContaining({ severity: 'warn', summary: 'Editing unavailable' }));
  });
});
