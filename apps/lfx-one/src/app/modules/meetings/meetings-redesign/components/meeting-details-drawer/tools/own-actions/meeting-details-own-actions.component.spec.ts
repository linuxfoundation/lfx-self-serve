// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { OverlayContainer } from '@angular/cdk/overlay';
import { computed, signal, WritableSignal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Meeting, MeetingDetailsState, MeetingHomeRow } from '@lfx-one/shared/interfaces';
import { MeetingService } from '@services/meeting.service';
import { UserService } from '@services/user.service';
import { UiToastService } from '@shared/uikit/toast/toast.service';
import { of } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MeetingDetailsContext } from '../../meeting-details.context';
import { MeetingDetailsOwnActionsComponent } from './meeting-details-own-actions.component';

const MEETING = {
  id: 'synthetic-meeting',
  title: 'Synthetic sync',
  invited: true,
  organizer: false,
  my_registrant_ids: ['reg-me'],
} as unknown as Meeting;

describe('MeetingDetailsOwnActionsComponent', () => {
  let fixture: ComponentFixture<MeetingDetailsOwnActionsComponent>;
  let meeting: WritableSignal<Meeting>;
  let state: WritableSignal<MeetingDetailsState>;
  let meetingService: Record<string, ReturnType<typeof vi.fn>>;
  let toastShow: ReturnType<typeof vi.fn>;
  let refreshList: ReturnType<typeof vi.fn>;
  const listedSelfRegistrantUids = signal<readonly string[]>([]);

  const settle = async (): Promise<void> => {
    await fixture.whenStable();
    await new Promise<void>((resolve) => setTimeout(resolve, 20));
  };
  const render = async (overrides: Partial<Meeting> = {}, dateState: MeetingDetailsState = 'far'): Promise<void> => {
    meeting.set({ ...MEETING, ...overrides });
    state.set(dateState);
    fixture = TestBed.createComponent(MeetingDetailsOwnActionsComponent);
    await settle();
  };
  const find = (testId: string): HTMLElement | null => fixture.nativeElement.querySelector(`[data-testid="${testId}"]`);
  const overlay = (testId: string): HTMLElement | null => document.querySelector(`[data-testid="${testId}"]`);
  const click = async (element: HTMLElement | null): Promise<void> => {
    (element?.querySelector('button') as HTMLButtonElement).click();
    await settle();
  };
  const removeConfirmed = async (): Promise<void> => {
    await click(find('meeting-details-remove'));
    await click(overlay('meeting-details-remove-confirm'));
  };

  beforeEach(() => {
    listedSelfRegistrantUids.set([]);
    meeting = signal(MEETING);
    state = signal<MeetingDetailsState>('far');
    meetingService = {
      resendMyMeetingInvitation: vi.fn().mockReturnValue(of({ message: 'ok' })),
      removeMyMeetingRegistration: vi.fn().mockReturnValue(of({ removed_registrant_ids: ['reg-me'], remaining_registrant_ids: [] })),
      markRegistrationRemoved: vi.fn(),
      rememberRemovedRegistrants: vi.fn(),
    };
    toastShow = vi.fn();
    refreshList = vi.fn();
    const row = computed(() => ({ key: meeting().id, meeting: meeting(), title: meeting().title, occurrenceId: 'occ-1' }) as MeetingHomeRow);
    const context = {
      row,
      meeting,
      shownRow: row,
      state,
      organizer: computed(() => meeting().organizer === true),
      invited: computed(() => !!meeting().invited),
      listedSelfRegistrantUids,
      refreshList,
    };

    TestBed.configureTestingModule({
      providers: [
        { provide: MeetingDetailsContext, useValue: context },
        { provide: MeetingService, useValue: meetingService },
        {
          provide: UserService,
          useValue: {
            authenticated: signal(true),
            user: signal({ sub: 'synthetic-viewer' }),
            viewerUsername: signal('synthetic-viewer'),
            clearConfirmedMeetingRsvps: vi.fn(),
            refreshUserMeetings: vi.fn(),
          },
        },
        { provide: UiToastService, useValue: { show: toastShow } },
      ],
    });
  });

  afterEach(() => {
    fixture?.destroy();
    TestBed.inject(OverlayContainer).ngOnDestroy();
  });

  it('resends the invite for the shown date', async () => {
    await render();
    await click(find('meeting-details-resend'));

    expect(meetingService['resendMyMeetingInvitation']).toHaveBeenCalledWith('synthetic-meeting', 'occ-1');
    expect(toastShow).toHaveBeenCalledWith(expect.objectContaining({ message: 'Meeting invitation sent' }));
  });

  it('removes the viewer after confirming', async () => {
    await render({ invited_via_committee: true });
    await click(find('meeting-details-remove'));

    expect(overlay('meeting-details-remove-message')?.textContent).toContain('Remove yourself from “Synthetic sync”?');
    expect(overlay('meeting-details-remove-notes')?.textContent).toContain("You stay in the committee, but it won't invite you to this meeting again.");
    await click(overlay('meeting-details-remove-confirm'));

    expect(meetingService['removeMyMeetingRegistration']).toHaveBeenCalledWith('synthetic-meeting', 'meetings-home');
    expect(meetingService['markRegistrationRemoved']).toHaveBeenCalledWith('synthetic-meeting', ['reg-me']);
    expect(toastShow).toHaveBeenCalledWith(expect.objectContaining({ message: 'Removed from meeting' }));
  });

  it('says so when some registrations survive the removal', async () => {
    meetingService['removeMyMeetingRegistration'].mockReturnValue(of({ removed_registrant_ids: [], remaining_registrant_ids: ['reg-me'] }));
    await render();
    await removeConfirmed();

    expect(refreshList).toHaveBeenCalled();
    expect(toastShow).toHaveBeenCalledWith(
      expect.objectContaining({
        variant: 'error',
        message: 'Removal incomplete',
        description: 'Some of your registrations could not be removed. You are still invited to this meeting. Please try again.',
      })
    );
  });

  it('offers nothing to an organizer without a registration of their own', async () => {
    await render({ organizer: true, my_registrant_ids: [] });
    expect(find('meeting-details-own-actions')).toBeNull();
  });

  it('offers them to an organizer the guests list shows under a new registration', async () => {
    listedSelfRegistrantUids.set(['reg-new']);
    await render({ organizer: true, my_registrant_ids: [] });
    expect(find('meeting-details-remove')).not.toBeNull();
    expect(find('meeting-details-resend')).not.toBeNull();
  });

  it('offers nothing once the date has ended', async () => {
    await render({}, 'ended');
    expect(find('meeting-details-own-actions')).toBeNull();
  });
});
