// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Clipboard } from '@angular/cdk/clipboard';
import { OverlayContainer } from '@angular/cdk/overlay';
import { HttpErrorResponse } from '@angular/common/http';
import { signal, WritableSignal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { environment } from '@environments/environment';
import { Meeting, MeetingDashboardView, MeetingHomeRow, MeetingRegistrationRemovalResult, PastMeeting } from '@lfx-one/shared/interfaces';
import { MeetingOwnInviteResendService } from '@services/meeting-own-invite-resend.service';
import { MeetingSelfRemovalService } from '@services/meeting-self-removal.service';
import { MeetingService } from '@services/meeting.service';
import { UserService } from '@services/user.service';
import { UiToastService } from '@shared/uikit/toast/toast.service';
import { of, Subject, throwError } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MeetingsHomeDeleteService } from '../../services/meetings-home-delete.service';
import { MeetingsHomeEditService } from '../../services/meetings-home-edit.service';
import { MeetingHomeActionsComponent } from './meeting-home-actions.component';

const INVITEE = {
  id: 'synthetic-meeting',
  title: 'Synthetic sync',
  project_name: 'Synthetic Project',
  meeting_type: 'Technical',
  password: 'synthetic-pass',
  invited: true,
  organizer: false,
  my_registrant_ids: ['synthetic-reg'],
  recurrence: null,
  occurrences: [],
} as unknown as Meeting;

const row = (meeting: Meeting | PastMeeting, overrides: Partial<MeetingHomeRow> = {}): MeetingHomeRow => ({
  key: meeting.id,
  meeting,
  occurrence: null,
  title: meeting.title,
  occurrenceId: 'synthetic-occurrence',
  startTime: '2026-11-05T15:00:00Z',
  durationMinutes: 60,
  ...overrides,
});

describe('MeetingHomeActionsComponent', () => {
  let fixture: ComponentFixture<MeetingHomeActionsComponent>;
  let overlay: HTMLElement;
  let removedIds: WritableSignal<ReadonlySet<string>>;
  let resending: WritableSignal<boolean>;
  let toastShow: ReturnType<typeof vi.fn>;
  let copy: ReturnType<typeof vi.fn>;
  let resendOwn$: ReturnType<typeof vi.fn>;
  let remove$: ReturnType<typeof vi.fn>;
  let refreshUserMeetings: ReturnType<typeof vi.fn>;
  let edit: ReturnType<typeof vi.fn>;
  let deleteMeeting: ReturnType<typeof vi.fn>;
  let checkingEdit: WritableSignal<boolean>;

  const settle = async (): Promise<void> => {
    await fixture.whenStable();
    await new Promise<void>((resolve) => setTimeout(resolve, 30));
  };
  const render = async (value: MeetingHomeRow, view: MeetingDashboardView = 'upcoming'): Promise<void> => {
    fixture = TestBed.createComponent(MeetingHomeActionsComponent);
    fixture.componentRef.setInput('row', value);
    fixture.componentRef.setInput('view', view);
    await settle();
  };
  const trigger = (): HTMLButtonElement => fixture.nativeElement.querySelector('[data-testid="meetings-home-row-actions-trigger"] button');
  const find = (testId: string): HTMLElement | null => overlay.querySelector(`[data-testid="${testId}"]`);
  const openMenu = async (): Promise<string[]> => {
    trigger().click();
    await settle();
    return [...overlay.querySelectorAll('[role="menuitem"]')].map((item) => item.textContent?.trim() ?? '');
  };
  const choose = async (testId: string): Promise<void> => {
    await openMenu();
    find(testId)?.click();
    await settle();
  };
  const confirmRemoval = async (): Promise<void> => {
    await choose('meetings-home-row-actions-remove');
    find('meetings-home-row-actions-remove-confirm')?.querySelector('button')?.click();
    await settle();
  };

  beforeEach(() => {
    removedIds = signal(new Set<string>());
    resending = signal(false);
    toastShow = vi.fn();
    copy = vi.fn().mockReturnValue(true);
    resendOwn$ = vi.fn().mockReturnValue(of({ message: 'ok' }));
    refreshUserMeetings = vi.fn();
    edit = vi.fn();
    deleteMeeting = vi.fn();
    checkingEdit = signal(false);
    remove$ = vi.fn().mockReturnValue(of({ removed_registrant_ids: ['synthetic-reg'], remaining_registrant_ids: [] }));

    TestBed.configureTestingModule({
      providers: [
        { provide: Clipboard, useValue: { copy } },
        { provide: UiToastService, useValue: { show: toastShow } },
        { provide: MeetingService, useValue: { removedRegistrationMeetingIds: removedIds } },
        { provide: UserService, useValue: { authenticated: signal(true), refreshUserMeetings } },
        {
          provide: MeetingOwnInviteResendService,
          useValue: { resendOwn$, isResendingOwn: () => resending(), describeOwnResendFailure: () => 'Unable to resend the invitation. Please try again.' },
        },
        { provide: MeetingSelfRemovalService, useValue: { remove$, describeFailure: () => 'Unable to remove you from this meeting. Please try again.' } },
        { provide: MeetingsHomeEditService, useValue: { edit, isChecking: () => checkingEdit() } },
        { provide: MeetingsHomeDeleteService, useValue: { delete: deleteMeeting } },
      ],
    });
    overlay = TestBed.inject(OverlayContainer).getContainerElement();
  });

  afterEach(() => {
    fixture?.destroy();
    TestBed.inject(OverlayContainer).ngOnDestroy();
  });

  describe('menu items', () => {
    it('offers Copy Link, Resend Invite and Remove Myself to a registered invitee', async () => {
      await render(row(INVITEE));

      expect(trigger().getAttribute('aria-label')).toBe('More actions');
      expect(await openMenu()).toEqual(['Copy Link', 'Resend Invite', 'Remove Myself']);
    });

    it('offers only Copy Link on a past meeting', async () => {
      await render(row(INVITEE), 'past');

      expect(await openMenu()).toEqual(['Copy Link']);
    });

    it('lets an invitee without a registrant row remove themselves but not resend', async () => {
      await render(row({ ...INVITEE, my_registrant_ids: [] }));

      expect(await openMenu()).toEqual(['Copy Link', 'Remove Myself']);
    });

    it('offers an organizer Copy Link and Delete Meeting without a registration of their own', async () => {
      await render(row({ ...INVITEE, organizer: true, my_registrant_ids: [] }));

      expect(await openMenu()).toEqual(['Copy Link', 'Delete Meeting']);
    });

    it('offers a registered organizer the attendee actions', async () => {
      await render(row({ ...INVITEE, organizer: true }));

      expect(await openMenu()).toEqual(['Copy Link', 'Resend Invite', 'Remove Myself', 'Delete Meeting']);
    });

    it('stops offering Resend and Remove once the registration was removed', async () => {
      removedIds.set(new Set([INVITEE.id]));
      await render(row(INVITEE));

      expect(await openMenu()).toEqual(['Copy Link']);
    });

    it('offers only Copy Link to a viewer who is not invited', async () => {
      await render(row({ ...INVITEE, invited: false }));

      expect(await openMenu()).toEqual(['Copy Link']);
    });
  });

  describe('Edit Meeting', () => {
    const ORGANIZER = { ...INVITEE, organizer: true, project_slug: 'synthetic-project' } as Meeting;

    it('goes first for an organizer of an upcoming meeting', async () => {
      await render(row(ORGANIZER));

      expect(await openMenu()).toEqual(['Edit Meeting', 'Copy Link', 'Resend Invite', 'Remove Myself', 'Delete Meeting']);
    });

    it.each([
      ['a past meeting', ORGANIZER, 'past' as MeetingDashboardView],
      ['a viewer who is not an organizer', { ...ORGANIZER, organizer: false }, 'upcoming' as MeetingDashboardView],
      ['a meeting without a project slug', { ...ORGANIZER, project_slug: undefined }, 'upcoming' as MeetingDashboardView],
    ])('is not offered on %s', async (_case, meeting, view) => {
      await render(row(meeting as Meeting), view);

      expect(await openMenu()).not.toContain('Edit Meeting');
    });

    it('hands the row to the edit flow', async () => {
      const value = row(ORGANIZER);
      await render(value);
      await choose('meetings-home-row-actions-edit');

      expect(edit).toHaveBeenCalledWith(value);
    });

    it('shows the trigger loading while the permission re-check runs', async () => {
      checkingEdit.set(true);
      await render(row(ORGANIZER));

      expect(trigger().getAttribute('aria-busy')).toBe('true');
    });
  });

  describe('Delete Meeting', () => {
    it('goes last, after a separator', async () => {
      await render(row({ ...INVITEE, organizer: true }));
      await openMenu();

      expect(find('meetings-home-row-actions-delete')?.previousElementSibling?.tagName.toLowerCase()).toBe('lfx-ui-menu-separator');
    });

    it('is not offered on a past meeting, even to an organizer', async () => {
      await render(row({ ...INVITEE, organizer: true }), 'past');

      expect(await openMenu()).toEqual(['Copy Link']);
      expect(find('meetings-home-row-actions-delete')).toBeNull();
    });

    it('hands the row to the delete flow', async () => {
      const value = row({ ...INVITEE, organizer: true });
      await render(value);
      await choose('meetings-home-row-actions-delete');

      expect(deleteMeeting).toHaveBeenCalledWith(value);
    });
  });

  describe('Copy Link', () => {
    it('copies the meeting link with its password and confirms with a dark toast', async () => {
      await render(row(INVITEE));
      await choose('meetings-home-row-actions-copy-link');

      expect(copy).toHaveBeenCalledWith(`${environment.urls.home}/meetings/synthetic-meeting?password=synthetic-pass`);
      expect(toastShow).toHaveBeenCalledWith({ variant: 'dark', message: 'Meeting link copied to clipboard' });
    });

    it('copies the past meeting page for a past row, without the passcode', async () => {
      const past = { ...INVITEE, meeting_and_occurrence_id: 'synthetic-meeting-occurrence' } as unknown as PastMeeting;
      await render(row(past), 'past');
      await choose('meetings-home-row-actions-copy-link');

      expect(copy).toHaveBeenCalledWith(`${environment.urls.home}/meetings/synthetic-meeting-occurrence`);
    });

    it('reports a failed copy', async () => {
      copy.mockReturnValue(false);
      await render(row(INVITEE));
      await choose('meetings-home-row-actions-copy-link');

      expect(toastShow).toHaveBeenCalledWith(expect.objectContaining({ variant: 'error', position: 'bottom-center', message: 'Copy Failed' }));
    });
  });

  describe('Resend Invite', () => {
    it("resends for the row's occurrence and confirms with a dark toast", async () => {
      await render(row(INVITEE));
      await choose('meetings-home-row-actions-resend');

      expect(resendOwn$).toHaveBeenCalledWith('synthetic-meeting', 'synthetic-occurrence');
      expect(toastShow).toHaveBeenCalledWith({ variant: 'dark', message: 'Meeting invitation sent' });
    });

    it('reports a failed resend', async () => {
      resendOwn$.mockReturnValue(throwError(() => new HttpErrorResponse({ status: 500 })));
      await render(row(INVITEE));
      await choose('meetings-home-row-actions-resend');

      expect(toastShow).toHaveBeenCalledWith(
        expect.objectContaining({ variant: 'error', message: 'Error', description: 'Unable to resend the invitation. Please try again.' })
      );
    });

    it('shows the trigger as loading while a resend is in flight', async () => {
      await render(row(INVITEE));
      resending.set(true);
      await settle();

      expect(trigger().getAttribute('aria-busy')).toBe('true');
    });
  });

  describe('Remove Myself', () => {
    it('asks first in an alertdialog with the meeting and the removal copy', async () => {
      await render(row({ ...INVITEE, invited_via_committee: true }));
      await choose('meetings-home-row-actions-remove');

      expect(overlay.querySelector('[role="alertdialog"]')).not.toBeNull();
      expect(find('meetings-home-row-actions-remove-info')?.textContent).toContain('Synthetic sync');
      expect(find('meeting-dialog-context-project')?.lastElementChild?.textContent?.trim()).toBe('Synthetic Project');
      const message = find('meetings-home-row-actions-remove-message');
      expect(find('meetings-home-row-actions-remove-info')?.compareDocumentPosition(message as Node)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
      const description = find('meetings-home-row-actions-remove-description');
      expect(overlay.querySelector('[role="alertdialog"]')?.getAttribute('aria-describedby')).toBe(description?.id);
      expect(description?.textContent).toContain("it won't invite you to this meeting again");
      expect(message?.textContent?.trim()).toBe(
        'Remove yourself from “Synthetic sync”? You will no longer be invited to any occurrence and will lose your RSVP.'
      );
      const notes = find('meetings-home-row-actions-remove-notes');
      expect(Array.from(notes?.querySelectorAll('li') ?? [], (item) => item.textContent?.trim())).toEqual([
        "You stay in the committee, but it won't invite you to this meeting again.",
      ]);
      expect(remove$).not.toHaveBeenCalled();
    });

    it('saves nothing on Cancel', async () => {
      await render(row(INVITEE));
      await choose('meetings-home-row-actions-remove');
      find('meetings-home-row-actions-remove-cancel')?.querySelector('button')?.click();
      await settle();

      expect(remove$).not.toHaveBeenCalled();
      expect(overlay.querySelector('[role="alertdialog"]')).toBeNull();
    });

    it('removes the registration, closes the dialog and confirms with a dark toast', async () => {
      await render(row(INVITEE));
      await confirmRemoval();

      expect(remove$).toHaveBeenCalledWith('synthetic-meeting', 'meetings-home');
      expect(overlay.querySelector('[role="alertdialog"]')).toBeNull();
      expect(toastShow).toHaveBeenCalledWith({ variant: 'dark', message: 'Removed from meeting' });
      expect(refreshUserMeetings).not.toHaveBeenCalled();
    });

    it('keeps the dialog open, busy and undismissable until the removal settles', async () => {
      const removal$ = new Subject<MeetingRegistrationRemovalResult>();
      remove$.mockReturnValue(removal$);
      await render(row(INVITEE));
      await confirmRemoval();

      expect(find('meetings-home-row-actions-remove-confirm')?.querySelector('button')?.getAttribute('aria-busy')).toBe('true');
      find('meetings-home-row-actions-remove-cancel')?.querySelector('button')?.click();
      document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', keyCode: 27, bubbles: true, cancelable: true }));
      await settle();
      expect(overlay.querySelector('[role="alertdialog"]')).not.toBeNull();
      removal$.next({ removed_registrant_ids: ['synthetic-reg'], remaining_registrant_ids: [] });
      removal$.complete();
      await settle();
      expect(overlay.querySelector('[role="alertdialog"]')).toBeNull();
    });

    it('sends one removal for a double click on Remove Me', async () => {
      remove$.mockReturnValue(new Subject<MeetingRegistrationRemovalResult>());
      await render(row(INVITEE));
      await choose('meetings-home-row-actions-remove');
      const confirm = find('meetings-home-row-actions-remove-confirm')?.querySelector('button');
      confirm?.click();
      confirm?.click();
      await settle();

      expect(remove$).toHaveBeenCalledTimes(1);
    });

    it('reports a sticky error when some registrations could not be removed', async () => {
      remove$.mockReturnValue(of({ removed_registrant_ids: ['synthetic-reg'], remaining_registrant_ids: ['synthetic-other-reg'] }));
      await render(row(INVITEE));
      await confirmRemoval();

      expect(toastShow).toHaveBeenCalledWith(expect.objectContaining({ variant: 'error', position: 'bottom-center', message: 'Removal incomplete' }));
      expect(toastShow.mock.lastCall?.[0]).not.toHaveProperty('duration');
      expect(refreshUserMeetings).toHaveBeenCalledWith();
    });

    it('reports a failed removal', async () => {
      remove$.mockReturnValue(throwError(() => new HttpErrorResponse({ status: 500 })));
      await render(row(INVITEE));
      await confirmRemoval();

      expect(toastShow).toHaveBeenCalledWith(
        expect.objectContaining({ variant: 'error', message: 'Error', description: 'Unable to remove you from this meeting. Please try again.' })
      );
      expect(overlay.querySelector('[role="alertdialog"]')).toBeNull();
    });
  });
});
