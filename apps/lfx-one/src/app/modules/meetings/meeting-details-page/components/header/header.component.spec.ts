// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { computed, PLATFORM_ID, signal, WritableSignal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Meeting, MeetingOccurrence, MeetingStatusKind, MeetingTimeState, PublicMeetingProject } from '@lfx-one/shared/interfaces';
import { environment } from '@environments/environment';
import { MAX_CUSTOM_DURATION, MAX_MEETING_DURATION } from '@lfx-one/shared/constants';
import { resolvePrivacy } from '@lfx-one/shared/utils';
import { ClipboardShareService } from '@services/clipboard-share.service';
import { FeatureFlagService } from '@services/feature-flag.service';
import { MeetingService } from '@services/meeting.service';
import { ProjectContextService } from '@services/project-context.service';
import { UserService } from '@services/user.service';
import { MessageService } from 'primeng/api';
import { DialogService } from 'primeng/dynamicdialog';
import { of, Subject, throwError } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { CancelOccurrenceConfirmationComponent } from '../../../components/cancel-occurrence-confirmation/cancel-occurrence-confirmation.component';
import { RescheduleOccurrenceDialogComponent } from '../../../components/reschedule-occurrence-dialog/reschedule-occurrence-dialog.component';
import { MeetingDetailsStateService } from '../../meeting-details-state.service';
import { MeetingHeaderComponent } from './header.component';

type LoadedMeeting = Meeting & { project: PublicMeetingProject };

describe('MeetingHeaderComponent', () => {
  let fixture: ComponentFixture<MeetingHeaderComponent>;
  let meeting: WritableSignal<LoadedMeeting | undefined>;
  let setFoundation: ReturnType<typeof vi.fn>;
  let copyLink: ReturnType<typeof vi.fn>;
  let timeState: WritableSignal<MeetingTimeState | null>;
  let meetingStatus: WritableSignal<MeetingStatusKind | null>;
  let myRsvpAttr: WritableSignal<string | null>;
  let canManageOccurrence: WritableSignal<boolean>;
  let selectedOccurrence: WritableSignal<MeetingOccurrence | null>;
  let meetingsV2Enabled: WritableSignal<boolean>;
  let showOccurrenceAfterChange: ReturnType<typeof vi.fn>;
  let nextLiveOccurrenceStartMs: ReturnType<typeof vi.fn>;
  let dialogClose: Subject<unknown>;
  let openDialog: ReturnType<typeof vi.fn>;
  let add: ReturnType<typeof vi.fn>;
  let loadedViaPastMeetingId: WritableSignal<boolean>;
  let pastMeetingFullAccess: WritableSignal<boolean>;
  let getPastMeetingRecording: ReturnType<typeof vi.fn>;

  const project: PublicMeetingProject = {
    uid: 'project-1',
    name: 'Acme Project',
    slug: 'acme-project',
    logo_url: 'https://acme-motors.example/logo.svg',
    parent_uid: 'foundation-1',
    parent: { uid: 'foundation-1', name: 'Acme Foundation', slug: 'acme-foundation' },
  };

  const build = (overrides: Partial<Meeting> = {}): LoadedMeeting =>
    ({
      id: 'meeting-1',
      title: 'Acme Weekly Sync',
      meeting_type: 'Technical',
      recurrence: null,
      committees: [],
      recording_enabled: false,
      transcript_enabled: false,
      youtube_upload_enabled: false,
      ai_summary_enabled: false,
      project_uid: 'project-1',
      ...overrides,
      project,
    }) as unknown as LoadedMeeting;

  async function create(platform: 'browser' | 'server' = 'browser'): Promise<void> {
    await TestBed.configureTestingModule({
      imports: [MeetingHeaderComponent],
      providers: [
        { provide: PLATFORM_ID, useValue: platform },
        {
          provide: MeetingDetailsStateService,
          useValue: {
            meeting,
            timeState,
            meetingStatus,
            selectedOccurrence,
            meetingTitle: computed(() => selectedOccurrence()?.title || meeting()?.title || ''),
            myRsvpAttr,
            canManageOccurrence,
            loadedViaPastMeetingId,
            pastMeetingFullAccess,
            showOccurrenceAfterChange,
            nextLiveOccurrenceStartMs,
            privacy: computed(() => {
              const current = meeting();
              return current ? resolvePrivacy(current.visibility, current.restricted) : null;
            }),
          },
        },
        { provide: ProjectContextService, useValue: { setFoundation } },
        { provide: ClipboardShareService, useValue: { copyLink } },
        { provide: MessageService, useValue: { add } },
        { provide: MeetingService, useValue: { getPastMeetingRecording } },
        { provide: UserService, useValue: { authenticated: signal(true) } },
        { provide: FeatureFlagService, useValue: { getBooleanFlag: () => meetingsV2Enabled } },
      ],
    })
      .overrideComponent(MeetingHeaderComponent, { set: { providers: [{ provide: DialogService, useValue: { open: openDialog } }] } })
      .compileComponents();

    fixture = TestBed.createComponent(MeetingHeaderComponent);
    fixture.detectChanges();
  }

  beforeEach(async () => {
    meeting = signal<LoadedMeeting | undefined>(build());
    setFoundation = vi.fn();
    copyLink = vi.fn();
    timeState = signal<MeetingTimeState | null>('before');
    meetingStatus = signal<MeetingStatusKind | null>('upcoming');
    myRsvpAttr = signal<string | null>(null);
    canManageOccurrence = signal(false);
    selectedOccurrence = signal<MeetingOccurrence | null>(null);
    meetingsV2Enabled = signal(false);
    showOccurrenceAfterChange = vi.fn();
    nextLiveOccurrenceStartMs = vi.fn().mockReturnValue(null);
    dialogClose = new Subject();
    openDialog = vi.fn().mockReturnValue({ onClose: dialogClose.asObservable(), onDestroy: dialogClose.asObservable() });
    add = vi.fn();
    loadedViaPastMeetingId = signal(false);
    pastMeetingFullAccess = signal(false);
    getPastMeetingRecording = vi.fn().mockReturnValue(of(null));
    await create();
  });

  afterEach(() => vi.restoreAllMocks());

  const query = (testId: string): HTMLElement | null => fixture.nativeElement.querySelector(`[data-testid="${testId}"]`);

  function show(overrides: Partial<Meeting>): void {
    meeting.set(build(overrides));
    fixture.detectChanges();
  }

  it('renders the project with its foundation, and the title as the page heading', () => {
    expect(query('meeting-header-project')?.textContent).toContain('Acme Project');
    expect(query('meeting-header-foundation')?.textContent?.trim()).toBe('Acme Foundation');
    expect(fixture.nativeElement.querySelector('h1')?.textContent?.trim()).toBe('Acme Weekly Sync');
  });

  it('opens the foundation overview in a new tab after setting the foundation context', () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null);

    query('meeting-header-project')?.click();

    expect(setFoundation).toHaveBeenCalledWith({ uid: 'foundation-1', name: 'Acme Foundation', slug: 'acme-foundation' });
    expect(open).toHaveBeenCalledWith('/foundation/overview', '_blank', 'noopener,noreferrer');
  });

  it('says the project link opens in a new tab', () => {
    expect(query('meeting-header-project')?.textContent).toContain('(opens in a new tab)');
  });

  it('falls back to the project itself for a top-level project', () => {
    vi.spyOn(window, 'open').mockReturnValue(null);
    meeting.set({ ...build(), project: { ...project, parent_uid: '', parent: null } });
    fixture.detectChanges();

    query('meeting-header-project')?.click();

    expect(setFoundation).toHaveBeenCalledWith({ uid: 'project-1', name: 'Acme Project', slug: 'acme-project' });
  });

  // FR-010: one chip, four values; an absent visibility reads as private, so label and icon agree.
  it.each([
    { visibility: 'public', restricted: false, label: 'Public', icon: 'fa-globe', state: ['public', 'false'], open: true },
    { visibility: 'public', restricted: true, label: 'Public (Restricted)', icon: 'fa-lock', state: ['public', 'true'], open: false },
    { visibility: 'private', restricted: false, label: 'Private', icon: 'fa-shield', state: ['private', 'false'], open: false },
    { visibility: 'private', restricted: true, label: 'Private (Restricted)', icon: 'fa-lock', state: ['private', 'true'], open: false },
    { visibility: null, restricted: true, label: 'Private (Restricted)', icon: 'fa-lock', state: ['private', 'true'], open: false },
    { visibility: null, restricted: false, label: 'Private', icon: 'fa-shield', state: ['private', 'false'], open: false },
  ])('renders one privacy chip for visibility $visibility, restricted $restricted', ({ visibility, restricted, label, icon, state, open }) => {
    show({ visibility, restricted } as Partial<Meeting>);

    const chips = fixture.nativeElement.querySelectorAll('[data-testid="meeting-privacy-chip"]');
    expect(chips.length).toBe(1);
    const chip = chips[0] as HTMLElement;
    expect(chip.textContent?.trim()).toBe(label);
    expect(chip.getAttribute('data-visibility')).toBe(state[0]);
    expect(chip.getAttribute('data-restricted')).toBe(state[1]);
    const glyph = chip.querySelector('i');
    expect(glyph?.classList).toContain(icon);
    // The colour is asserted in both branches: green for a meeting anyone can join, muted otherwise.
    expect(glyph?.classList.contains('text-[var(--md-status-good)]')).toBe(open);
    expect(glyph?.classList.contains('text-[var(--md-text-muted)]')).toBe(!open);
  });

  // The status itself is resolved once in the state service (and tested there and in
  // resolveMeetingStatus); the header renders it.
  describe('status pill', () => {
    const pill = (): HTMLElement | null => query('meeting-status-pill');

    function status(state: MeetingTimeState, kind: MeetingStatusKind): void {
      timeState.set(state);
      meetingStatus.set(kind);
      fixture.detectChanges();
    }

    it('leads the badge row with the page status', () => {
      expect(query('meeting-header-badges')?.firstElementChild).toBe(pill());
      expect(pill()?.textContent?.trim()).toBe('Upcoming');
      expect(pill()?.getAttribute('data-state')).toBe('before');
      expect(pill()?.getAttribute('data-status')).toBe('upcoming');
    });

    it.each([
      ['live', 'starting-soon', 'Starting soon'],
      ['live', 'live', 'In progress'],
      ['ended', 'ended', 'Ended'],
      ['before', 'going', "You're going"],
      ['before', 'cant-attend', "Can't attend"],
    ] as [MeetingTimeState, MeetingStatusKind, string][])('renders %s / %s as "%s"', (state, kind, label) => {
      status(state, kind);

      expect(pill()?.textContent?.trim()).toBe(label);
      expect(pill()?.getAttribute('data-state')).toBe(state);
      expect(pill()?.getAttribute('data-status')).toBe(kind);
    });

    // Absent while the viewer's own RSVP is unknown (not loaded, or not theirs to give), never a wrong "none".
    it('leaves data-my-rsvp off while the RSVP is unknown', () => {
      expect(pill()?.hasAttribute('data-my-rsvp')).toBe(false);
    });

    it("carries the viewer's own RSVP once it has loaded (E2-04)", () => {
      myRsvpAttr.set('none');
      fixture.detectChanges();
      expect(pill()?.getAttribute('data-my-rsvp')).toBe('none');

      myRsvpAttr.set('accepted');
      fixture.detectChanges();
      expect(pill()?.getAttribute('data-my-rsvp')).toBe('accepted');
    });
  });

  it('shows the meeting type with its configured label', () => {
    expect(query('meeting-header-badge-type')?.textContent).toContain('Technical');
  });

  it('shows no type chip for a meeting whose type is None', () => {
    show({ meeting_type: 'None' } as Partial<Meeting>);

    expect(query('meeting-header-badge-type')).toBeNull();
  });

  // ClipboardShareService confirms a copy or reports a failed clipboard write; it is tested itself.
  it('copies the meeting link, with the password when the payload has one, through the shared clipboard service', () => {
    show({ password: 'a&b' } as Partial<Meeting>);

    query('meeting-header-copy-link')?.querySelector('button')?.click();

    const copied = new URL(copyLink.mock.calls[0][0]);
    expect(`${copied.origin}${copied.pathname}`).toBe(`${environment.urls.home}/meetings/meeting-1`);
    expect(copied.searchParams.get('password')).toBe('a&b');
  });

  it('has no foundation link when the project has a parent the BFF could not resolve', () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    meeting.set({ ...build(), project: { ...project, parent_uid: 'foundation-1', parent: null } });
    fixture.detectChanges();

    const context = query('meeting-header-project');
    expect(context?.tagName).toBe('DIV');
    context?.click();
    expect(setFoundation).not.toHaveBeenCalled();
    expect(open).not.toHaveBeenCalled();
  });

  // A past record of a one-off meeting also has `meeting_id` unlike its composite `id`, so the ids are
  // no series signal; only a recurrence rule is, as in v1.
  it('shows no Recurring for a finished one-off meeting', () => {
    show({ recurrence: null, meeting_id: 'meeting-original', id: 'meeting-original-1700000000000' } as Partial<Meeting>);

    expect(query('meeting-header-badge-recurring')).toBeNull();
  });

  it('shows Recurring only for a recurring meeting', () => {
    expect(query('meeting-header-badge-recurring')).toBeNull();

    show({ recurrence: { type: 2 } as Meeting['recurrence'] });

    expect(query('meeting-header-badge-recurring')).not.toBeNull();
  });

  it('links each committee to its group page in a new tab, skipping ones without a name or uid', () => {
    show({
      committees: [
        { uid: 'c-1', name: 'Steering Committee' },
        { uid: 'c/2?x', name: 'Odd Uid Committee' },
        { uid: 'c-3' },
        { uid: '', name: 'Unlinked' },
      ] as Meeting['committees'],
    });

    const link = query('meeting-header-badge-committee-c-1') as HTMLAnchorElement;
    expect(link.getAttribute('href')).toBe('/groups/c-1');
    expect(link.target).toBe('_blank');
    expect(link.rel).toContain('noopener');
    expect(link.textContent).toContain('Steering Committee');
    expect(link.getAttribute('title')).toBe('Steering Committee');
    expect(query('meeting-header-badge-committee-c/2?x')?.getAttribute('href')).toBe('/groups/c%2F2%3Fx');
    expect(fixture.nativeElement.querySelectorAll('[data-testid^="meeting-header-badge-committee-"]').length).toBe(2);
  });

  it.each(['before', 'live'] as const)('shows each feature badge from its flag alone while the meeting is %s', (state) => {
    timeState.set(state);
    for (const id of ['recording', 'transcripts', 'youtube', 'ai-summary']) {
      expect(query(`meeting-header-badge-${id}`)).toBeNull();
    }

    show({ recording_enabled: true, transcript_enabled: true, youtube_upload_enabled: true, ai_summary_enabled: true });

    for (const id of ['recording', 'transcripts', 'youtube', 'ai-summary']) {
      expect(query(`meeting-header-badge-${id}`)).not.toBeNull();
    }
  });

  // V1 keeps the setting chips once a meeting has ended.
  it('keeps the Recording, Transcripts and AI Summary chips once the meeting has ended, as V1 does', () => {
    timeState.set('ended');
    show({ recording_enabled: true, transcript_enabled: true, youtube_upload_enabled: true, ai_summary_enabled: true });

    for (const id of ['recording', 'transcripts', 'youtube', 'ai-summary']) {
      expect(query(`meeting-header-badge-${id}`)).not.toBeNull();
    }
  });

  describe("V1's Recording chip on a past occurrence opened by its own id", () => {
    const pastId = '99152950841-1700000000000';

    async function showPast(fullAccess = true, recordingEnabled = false): Promise<void> {
      loadedViaPastMeetingId.set(true);
      pastMeetingFullAccess.set(fullAccess);
      timeState.set('ended');
      show({ id: pastId, recording_enabled: recordingEnabled } as Partial<Meeting>);
      // The recording read runs from an effect: let it settle, then render its answer.
      await fixture.whenStable();
      fixture.detectChanges();
    }

    it('shows Recording when the recording actually loads, whatever the setting', async () => {
      getPastMeetingRecording.mockReturnValue(of({ sessions: [{ share_url: 'https://zoom.example/rec/1', total_size: 10 }] }));
      await showPast();

      expect(getPastMeetingRecording).toHaveBeenCalled();
      expect(query('meeting-header-badge-recording')).not.toBeNull();
    });

    it('shows no Recording when there is no recording, or it cannot be read', async () => {
      getPastMeetingRecording.mockReturnValue(throwError(() => ({ status: 404 })));
      await showPast();

      expect(query('meeting-header-badge-recording')).toBeNull();
    });

    it('reads no recording without full access, and shows no Recording', async () => {
      await showPast(false, true);

      expect(getPastMeetingRecording).not.toHaveBeenCalled();
      expect(query('meeting-header-badge-recording')).toBeNull();
    });
  });

  describe("V1's occurrence actions", () => {
    const occurrence = { occurrence_id: 'occ-2', start_time: '2026-11-03T15:00:00Z', duration: 60 } as MeetingOccurrence;

    function manage(): void {
      show({ recurrence: { type: 2, repeat_interval: 1 } as Meeting['recurrence'], organizer: true });
      selectedOccurrence.set(occurrence);
      canManageOccurrence.set(true);
      fixture.detectChanges();
    }

    it('offers Edit and Cancel this occurrence only when the state service allows it', () => {
      expect(query('meeting-occurrence-edit-button')).toBeNull();
      expect(query('meeting-occurrence-cancel-button')).toBeNull();

      manage();

      expect(query('meeting-occurrence-edit-button')).not.toBeNull();
      expect(query('meeting-occurrence-cancel-button')).not.toBeNull();
      expect(query('meeting-header-copy-link')).not.toBeNull();
    });

    it.each([
      [false, MAX_CUSTOM_DURATION],
      [true, MAX_MEETING_DURATION],
    ])("opens V1's Edit Occurrence dialog for the selected occurrence (composer flag %s caps the duration at %s)", (v2, maxDuration) => {
      meetingsV2Enabled.set(v2);
      manage();

      query('meeting-occurrence-edit-button')?.querySelector('button')?.click();

      expect(openDialog).toHaveBeenCalledWith(
        RescheduleOccurrenceDialogComponent,
        expect.objectContaining({ header: 'Edit Occurrence', width: '520px', data: { meeting: meeting(), occurrence, maxDuration } })
      );
    });

    it("follows an edited occurrence to its new start, with V1's confirmation toast", () => {
      manage();
      query('meeting-occurrence-edit-button')?.querySelector('button')?.click();

      dialogClose.next({ confirmed: true, start_time: '2026-11-04T16:00:00Z' });

      expect(add).toHaveBeenCalledWith(expect.objectContaining({ severity: 'success', summary: 'Occurrence updated' }));
      expect(showOccurrenceAfterChange).toHaveBeenCalledWith(Date.parse('2026-11-04T16:00:00Z'));
    });

    it('changes nothing when the edit dialog closes without a confirmed new start', () => {
      manage();
      query('meeting-occurrence-edit-button')?.querySelector('button')?.click();

      dialogClose.next(undefined);

      expect(add).not.toHaveBeenCalled();
      expect(showOccurrenceAfterChange).not.toHaveBeenCalled();
    });

    // V1's `meetingTitle`: an occurrence edit can give the occurrence its own title.
    it("shows the selected occurrence's own title over the meeting's", () => {
      manage();
      selectedOccurrence.set({ ...occurrence, title: 'Acme Sync: release review' });
      fixture.detectChanges();

      expect(fixture.nativeElement.querySelector('h1')?.textContent?.trim()).toBe('Acme Sync: release review');
    });

    it('keeps the successor it read when the cancel dialog opened, even if the selection moves on meanwhile', () => {
      nextLiveOccurrenceStartMs.mockReturnValue(1_800_000_000_000);
      manage();
      query('meeting-occurrence-cancel-button')?.querySelector('button')?.click();

      // The 30-second clock moves the selection on while the dialog is open.
      nextLiveOccurrenceStartMs.mockReturnValue(1_900_000_000_000);
      dialogClose.next({ confirmed: true });

      expect(showOccurrenceAfterChange).toHaveBeenCalledWith(1_800_000_000_000);
    });

    it("moves to the cancelled occurrence's successor after a confirmed cancel", () => {
      nextLiveOccurrenceStartMs.mockReturnValue(1_800_000_000_000);
      manage();
      query('meeting-occurrence-cancel-button')?.querySelector('button')?.click();

      expect(openDialog).toHaveBeenCalledWith(
        CancelOccurrenceConfirmationComponent,
        expect.objectContaining({ header: 'Cancel Occurrence', width: '450px', data: { meeting: meeting(), occurrence } })
      );

      dialogClose.next({ confirmed: true });

      expect(add).toHaveBeenCalledWith(expect.objectContaining({ severity: 'success', summary: 'Occurrence cancelled' }));
      expect(showOccurrenceAfterChange).toHaveBeenCalledWith(1_800_000_000_000);
    });

    it("reports a failed cancel with V1's error toast and stays put", () => {
      manage();
      query('meeting-occurrence-cancel-button')?.querySelector('button')?.click();

      dialogClose.next({ confirmed: false, error: 'Upstream refused the cancel' });

      expect(add).toHaveBeenCalledWith({ severity: 'error', summary: 'Error', detail: 'Upstream refused the cancel' });
      expect(showOccurrenceAfterChange).not.toHaveBeenCalled();
    });
  });

  it('falls back to an icon when the project has no logo', () => {
    meeting.set({ ...build(), project: { ...project, logo_url: '' } });
    fixture.detectChanges();

    expect(query('meeting-header-project')?.querySelector('img')).toBeNull();
    expect(query('meeting-header-project')?.querySelector('.fa-cube')).not.toBeNull();
  });

  it('renders nothing before the meeting has loaded', () => {
    meeting.set(undefined);
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('h1')).toBeNull();
  });

  describe('on the server', () => {
    beforeEach(async () => {
      TestBed.resetTestingModule();
      await create('server');
    });

    it('neither sets the foundation nor opens a tab', () => {
      const open = vi.spyOn(window, 'open').mockReturnValue(null);

      query('meeting-header-project')?.click();

      expect(setFoundation).not.toHaveBeenCalled();
      expect(open).not.toHaveBeenCalled();
    });
  });
});
