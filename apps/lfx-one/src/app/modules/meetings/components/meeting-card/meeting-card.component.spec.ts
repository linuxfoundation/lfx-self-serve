// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Meeting } from '@lfx-one/shared/interfaces';
import { MeetingComposerService } from '@app/modules/meetings/meeting-composer/meeting-composer.service';
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

  /** Mounts the card over `meeting` with an empty template — this suite exercises the handler, not the markup. */
  async function mount(meeting: Meeting = MEETING): Promise<MeetingCardComponent> {
    TestBed.configureTestingModule({
      providers: [
        { provide: UserService, useValue: { user: signal(null), authenticated: signal(false) } },
        { provide: ProjectService, useValue: { project: signal(null) } },
        { provide: MeetingComposerService, useValue: { open: composerOpen } },
        { provide: MessageService, useValue: { add: toastAdd } },
        { provide: ConfirmationService, useValue: {} },
        { provide: DialogService, useValue: { open: vi.fn() } },
        {
          provide: MeetingService,
          useValue: {
            getMeetingDetail,
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
    fixture.detectChanges();

    return fixture.componentInstance;
  }

  beforeEach(() => {
    composerOpen = vi.fn();
    toastAdd = vi.fn();
    getMeetingDetail = vi.fn().mockReturnValue(of({ ...MEETING, organizer: true }));
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
});
