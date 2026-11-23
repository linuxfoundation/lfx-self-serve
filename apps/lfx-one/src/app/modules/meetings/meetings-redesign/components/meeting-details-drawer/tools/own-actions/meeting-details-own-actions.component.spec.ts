// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { OverlayContainer } from '@angular/cdk/overlay';
import { computed, signal, WritableSignal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Meeting, MeetingDetailsState, MeetingHomeRow } from '@lfx-one/shared/interfaces';
import { MeetingService } from '@services/meeting.service';
import { UserService } from '@services/user.service';
import { UiToastService } from '@shared/uikit/toast/toast.service';
import { of, Subject } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MeetingDetailsContext } from '../../meeting-details.context';
import { MeetingDetailsSource } from '../../meeting-details.source';
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
  let selfInvite: WritableSignal<readonly string[] | undefined>;
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
    selfInvite = signal(undefined);
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
        { provide: MeetingDetailsSource, useValue: { selfInviteOf: () => selfInvite() } },
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

  it('blocks resend but preserves removal while an invite is syncing, including an open confirmation', async () => {
    await render();
    await click(find('meeting-details-resend'));
    selfInvite.set([]);
    await click(overlay('meeting-details-resend-confirm'));
    expect(meetingService['resendMyMeetingInvitation']).not.toHaveBeenCalled();
    expect(overlay('meeting-details-resend-dialog')).toBeNull();
    expect(find('meeting-details-resend')).toBeNull();
    expect(find('meeting-details-remove')).not.toBeNull();

    selfInvite.set(undefined);
    await settle();
    expect(find('meeting-details-resend')).not.toBeNull();
  });

  it('asks before resending, in an alertdialog naming the meeting, and sends nothing yet', async () => {
    await render();
    await click(find('meeting-details-resend'));

    expect(overlay('meeting-details-resend-dialog')?.textContent).toContain('Resend Your Invitation');
    const message = overlay('meeting-details-resend-message');
    expect(message?.textContent?.trim()).toBe("Resend your invitation to “Synthetic sync”? We'll email it to your own address again.");
    expect(document.querySelector('[role="alertdialog"]')?.getAttribute('aria-describedby')).toBe(message?.id);
    expect(overlay('meeting-details-resend-cancel')?.textContent?.trim()).toBe('Cancel');
    expect(overlay('meeting-details-resend-confirm')?.textContent?.trim()).toBe('Resend');
    expect(meetingService['resendMyMeetingInvitation']).not.toHaveBeenCalled();
  });

  it('sends nothing on Cancel', async () => {
    await render();
    await click(find('meeting-details-resend'));
    await click(overlay('meeting-details-resend-cancel'));

    expect(overlay('meeting-details-resend-dialog')).toBeNull();
    expect(meetingService['resendMyMeetingInvitation']).not.toHaveBeenCalled();
    expect(toastShow).not.toHaveBeenCalled();
  });

  it('resends the invite for the shown date once confirmed, then closes the dialog', async () => {
    await render();
    await click(find('meeting-details-resend'));
    await click(overlay('meeting-details-resend-confirm'));

    expect(meetingService['resendMyMeetingInvitation']).toHaveBeenCalledTimes(1);
    expect(meetingService['resendMyMeetingInvitation']).toHaveBeenCalledWith('synthetic-meeting', 'occ-1');
    expect(overlay('meeting-details-resend-dialog')).toBeNull();
    expect(toastShow).toHaveBeenCalledWith(expect.objectContaining({ message: 'Meeting invitation sent' }));
  });

  it('keeps the dialog open and busy until the send settles, and sends once for a double click', async () => {
    const send$ = new Subject<{ message: string }>();
    meetingService['resendMyMeetingInvitation'].mockReturnValue(send$);
    await render();
    await click(find('meeting-details-resend'));
    const confirm = overlay('meeting-details-resend-confirm')?.querySelector('button') as HTMLButtonElement;
    confirm.click();
    confirm.click();
    await settle();

    expect(meetingService['resendMyMeetingInvitation']).toHaveBeenCalledTimes(1);
    expect(overlay('meeting-details-resend-confirm')?.querySelector('button')?.getAttribute('aria-busy')).toBe('true');
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', keyCode: 27, bubbles: true, cancelable: true }));
    await settle();
    expect(overlay('meeting-details-resend-dialog')).not.toBeNull();
    send$.next({ message: 'ok' });
    send$.complete();
    await settle();
    expect(overlay('meeting-details-resend-dialog')).toBeNull();
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
