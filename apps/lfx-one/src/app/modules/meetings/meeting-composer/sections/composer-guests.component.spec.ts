// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FormControl, FormGroup } from '@angular/forms';
import type { CommitteeMember, ComposerGuestRow, Meeting, MeetingRegistrantWithState } from '@lfx-one/shared/interfaces';
import { CommitteeService } from '@services/committee.service';
import { MeetingService } from '@services/meeting.service';
import { ProjectContextService } from '@services/project-context.service';
import { MessageService } from 'primeng/api';
import { DialogService } from 'primeng/dynamicdialog';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { MeetingComposerFormService } from '../meeting-composer-form.service';
import { ComposerGuestsComponent } from './composer-guests.component';

describe('ComposerGuestsComponent', () => {
  let fixture: ComponentFixture<ComposerGuestsComponent>;
  let component: ComposerGuestsComponent;
  let formService: MeetingComposerFormService;

  const savedGroupGuest: MeetingRegistrantWithState = {
    uid: 'registrant-1',
    meeting_id: 'meeting-1',
    occurrence_id: null,
    email: 'member@example.com',
    first_name: 'Member',
    last_name: 'One',
    job_title: null,
    org_name: null,
    host: false,
    org_is_member: false,
    org_is_project_member: false,
    avatar_url: null,
    username: null,
    linkedin_profile: null,
    created_at: '',
    updated_at: '',
    type: 'committee',
    invite_accepted: null,
    attended: null,
    state: 'existing',
  };

  const member = { email: 'member@example.com', first_name: 'Member', last_name: 'One' } as CommitteeMember;

  const reconcile = (members: CommitteeMember[]): void => component['onCommitteeMembersChange'](members);

  beforeEach(async () => {
    TestBed.configureTestingModule({
      providers: [
        MeetingComposerFormService,
        { provide: MessageService, useValue: { add: vi.fn() } },
        { provide: DialogService, useValue: { open: vi.fn() } },
        { provide: CommitteeService, useValue: {} },
        { provide: ProjectContextService, useValue: { activeContextUid: () => null } },
        {
          provide: MeetingService,
          useValue: {
            createRegistrantFormGroup: () => new FormGroup({ email: new FormControl('') }),
            stripMetadata: (meetingUid: string, guest: MeetingRegistrantWithState) => ({ ...guest, meeting_id: meetingUid }),
            getChangedFields: () => ({}),
          },
        },
      ],
    });
    TestBed.overrideComponent(ComposerGuestsComponent, { set: { template: '', imports: [] } });

    formService = TestBed.inject(MeetingComposerFormService);
    formService.initialize({ mode: 'create', projectUid: 'project-1' });

    fixture = TestBed.createComponent(ComposerGuestsComponent);
    fixture.componentRef.setInput('form', formService.form());
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  /**
   * Covers guest reconciliation against group membership. The committee manager emits on mount and on
   * every fetch, and the consumer must not read an emission it can't trust as "nobody is in a group" —
   * that would queue every saved group guest for deletion behind the organizer's back.
   */
  describe('committee member reconciliation', () => {
    it('queues a saved group guest for deletion once they leave every selected group', () => {
      formService.setGuests([savedGroupGuest]);

      reconcile([]);

      expect(formService.guests().map((guest) => guest.state)).toEqual(['deleted']);
    });

    it('restores a guest queued for deletion when they turn up in a selected group again', () => {
      formService.setGuests([savedGroupGuest]);

      reconcile([]);
      reconcile([member]);

      expect(formService.guests()).toHaveLength(1);
      expect(formService.guests()[0].state).toBe('existing');
      expect(formService.guests()[0].uid).toBe('registrant-1');
    });

    it('keeps a hand-removed saved guest deleted even while they stay in a selected group', () => {
      formService.setGuests([savedGroupGuest]);

      component['onRemoveGuest'](savedGroupGuest);
      reconcile([member]);

      expect(formService.guests()).toHaveLength(1);
      expect(formService.guests()[0].state).toBe('deleted');
    });

    it('leaves direct guests untouched', () => {
      formService.setGuests([{ ...savedGroupGuest, type: 'direct' }]);

      reconcile([]);

      expect(formService.guests()[0].state).toBe('existing');
    });

    it('does not re-add a group guest the organizer just removed', () => {
      reconcile([member]);
      const added = formService.guests()[0];
      component['onRemoveGuest'](added);

      reconcile([member]);

      expect(formService.guests()).toHaveLength(0);
    });
  });
  /**
   * Covers the two things the projected rows have to get right for the list to behave: a `track` key
   * that never repeats, and a remove button that says which guest it removes. Both only go wrong on
   * registrants the happy path doesn't produce — a duplicated email, a missing name — so neither is
   * reachable from the reconciliation tests above.
   */
  describe('guest rows', () => {
    const rows = (): ComposerGuestRow[] => component['guestRows']();

    it('keeps the track key unique when two guests share an email', () => {
      // The same person can arrive twice: carried in from a group, and typed in by hand. `@for`
      // raises on a duplicate key, so the second row must not borrow the first one's identity.
      formService.setGuests([
        { ...savedGroupGuest, uid: '' },
        { ...savedGroupGuest, uid: '', type: 'direct' },
      ]);

      const keys = rows().map((row) => row.trackId);

      expect(new Set(keys).size).toBe(keys.length);
    });

    it('prefers the saved uid over the pending tempId', () => {
      formService.setGuests([{ ...savedGroupGuest, tempId: 'temp_1' }]);

      expect(rows()[0].trackId).toBe('registrant-1');
    });

    it('names the guest in the remove button', () => {
      formService.setGuests([savedGroupGuest]);

      expect(rows()[0].removeLabel).toBe('Remove Member One');
    });

    it('falls back to the email when the registrant has no name', () => {
      // The icon-only button has no other content, so a bare "Remove" would leave a screen-reader
      // user counting rows. The email is what identifies the row on screen here too.
      formService.setGuests([{ ...savedGroupGuest, first_name: '', last_name: '' }]);

      expect(rows()[0].removeLabel).toBe('Remove member@example.com');
    });

    it('still identifies the button when the registrant has neither a name nor an email', () => {
      formService.setGuests([{ ...savedGroupGuest, first_name: '', last_name: '', email: '' }]);

      expect(rows()[0].removeLabel).toBe('Remove guest');
    });
  });

  /**
   * Covers the RSVP summary issue #1457 asks the stats line to carry.
   * @description The whole risk is the denominator: `invite_accepted` says nothing about a guest
   * nobody has invited yet, so counting the pending queue would report a wall of non-responses
   * the moment somebody adds a group, and the three parts would stop adding up to the whole.
   */
  describe('acceptance stats', () => {
    const guest = (state: MeetingRegistrantWithState['state'], inviteAccepted: boolean | null): MeetingRegistrantWithState => ({
      ...savedGroupGuest,
      uid: `registrant-${state}-${String(inviteAccepted)}-${Math.random()}`,
      state,
      invite_accepted: inviteAccepted,
    });

    it('counts nobody as invited while every guest is still queued', () => {
      formService.setGuests([guest('new', null), guest('new', null)]);

      expect(component['invitedGuestCount']()).toBe(0);
      expect(component['acceptedGuestCount']()).toBe(0);
    });

    it('splits the invited guests across accepted, declined and awaiting', () => {
      formService.setGuests([
        guest('existing', true),
        guest('modified', true),
        guest('existing', false),
        guest('existing', null),
        // Queued, so outside every count below.
        guest('new', null),
      ]);

      expect(component['invitedGuestCount']()).toBe(4);
      expect(component['acceptedGuestCount']()).toBe(2);
      expect(component['declinedGuestCount']()).toBe(1);
      expect(component['pendingGuestCount']()).toBe(1);
    });

    it('keeps the three parts adding up to the invited total', () => {
      formService.setGuests([guest('existing', true), guest('existing', false), guest('existing', null), guest('modified', true)]);

      const parts = component['acceptedGuestCount']() + component['declinedGuestCount']() + component['pendingGuestCount']();

      expect(parts).toBe(component['invitedGuestCount']());
    });

    it('counts a registrant whose response never arrived as awaiting rather than dropping it', () => {
      // Typed as required upstream, but the count is derived by exclusion so an absent field
      // cannot silently leave the breakdown short of the total.
      const unanswered = { ...guest('existing', null), invite_accepted: undefined } as unknown as MeetingRegistrantWithState;
      formService.setGuests([unanswered]);

      expect(component['pendingGuestCount']()).toBe(1);
      expect(component['invitedGuestCount']()).toBe(1);
    });

    it('drops a guest queued for removal from every count', () => {
      formService.setGuests([guest('existing', true), guest('deleted', true)]);

      expect(component['invitedGuestCount']()).toBe(1);
      expect(component['acceptedGuestCount']()).toBe(1);
    });

    it('spells the full split out in the tooltip the summary hides', () => {
      formService.setGuests([guest('existing', true), guest('existing', false), guest('existing', null)]);

      expect(component['acceptanceBreakdown']()).toBe('1 accepted \u00b7 1 declined \u00b7 1 awaiting a reply');
    });

    it('hides the summary on a meeting that does not collect responses', () => {
      // Nobody can answer, so every invited guest sits at "awaiting a reply" permanently. Showing
      // the line would report the whole guest list as unresponsive over a question never asked.
      formService.meeting.set({ is_invite_responses_enabled: false } as Meeting);
      formService.setGuests([guest('existing', true), guest('existing', null)]);

      expect(component['inviteResponsesEnabled']()).toBe(false);
      expect(component['showAcceptanceSummary']()).toBe(false);
    });

    it('hides the summary in create mode, where there is no meeting to read the flag off', () => {
      formService.setGuests([guest('existing', true)]);

      expect(component['showAcceptanceSummary']()).toBe(false);
    });

    it('shows the summary once responses are on and somebody has been invited', () => {
      formService.meeting.set({ is_invite_responses_enabled: true } as Meeting);
      formService.setGuests([guest('existing', true), guest('new', null)]);

      expect(component['showAcceptanceSummary']()).toBe(true);
      expect(component['acceptanceSummary']()).toBe('1 of 1 accepted');
    });

    it('still hides the summary with responses on but nobody invited yet', () => {
      formService.meeting.set({ is_invite_responses_enabled: true } as Meeting);
      formService.setGuests([guest('new', null)]);

      expect(component['showAcceptanceSummary']()).toBe(false);
    });

    it('repeats the visible line in the accessible name on the tooltip', () => {
      // `pTooltip` renders its own element rather than a native `title`, so the breakdown reaches a
      // screen reader only through this label — and `aria-label` replaces the span's text.
      formService.meeting.set({ is_invite_responses_enabled: true } as Meeting);
      formService.setGuests([guest('existing', true), guest('existing', false)]);

      expect(component['acceptanceLabel']()).toBe('1 of 2 accepted \u00b7 1 accepted \u00b7 1 declined \u00b7 0 awaiting a reply');
    });
  });

  /**
   * Covers removal identity for a guest with neither a uid nor a tempId.
   * @description `guestRows` keys such a row by its render index, which the mutation here has no
   * access to — it is rebuilding the array that list is projected from. Before the object-identity
   * arm, both keyless rows resolved to the same `undefined` key and removing either dropped both.
   */
  describe('removing a keyless guest', () => {
    const keyless = (email: string, state: MeetingRegistrantWithState['state']): MeetingRegistrantWithState => ({
      ...savedGroupGuest,
      uid: '',
      email,
      type: 'direct',
      state,
    });

    it('drops only the guest asked for when two carry no identity at all', () => {
      const first = keyless('first@example.com', 'new');
      const second = keyless('second@example.com', 'new');
      formService.setGuests([first, second]);

      component['onRemoveGuest'](first);

      expect(formService.guests().map((entry) => entry.email)).toEqual(['second@example.com']);
    });

    it('queues only the guest asked for when both are saved upstream', () => {
      const first = keyless('first@example.com', 'existing');
      const second = keyless('second@example.com', 'existing');
      formService.setGuests([first, second]);

      component['onRemoveGuest'](second);

      expect(formService.guests().map((entry) => [entry.email, entry.state])).toEqual([
        ['first@example.com', 'existing'],
        ['second@example.com', 'deleted'],
      ]);
    });

    it('still keys on the tempId when the guest has one', () => {
      const first = { ...keyless('first@example.com', 'new'), tempId: 'temp_1' };
      const second = { ...keyless('second@example.com', 'new'), tempId: 'temp_2' };
      formService.setGuests([first, second]);

      // A copy, not the object in the list: the tempId is what has to match, not the reference.
      component['onRemoveGuest']({ ...first });

      expect(formService.guests().map((entry) => entry.email)).toEqual(['second@example.com']);
    });
  });
});
