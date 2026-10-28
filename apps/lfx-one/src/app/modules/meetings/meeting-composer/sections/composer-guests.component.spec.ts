// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { LiveAnnouncer } from '@angular/cdk/a11y';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FormControl, FormGroup } from '@angular/forms';
import type { CommitteeMember, ComposerGuestRow, Meeting, MeetingRegistrantWithState } from '@lfx-one/shared/interfaces';
import { CommitteeService } from '@services/committee.service';
import { MeetingService } from '@services/meeting.service';
import { ProjectContextService } from '@services/project-context.service';
import { ConfirmationService, MessageService } from 'primeng/api';
import { DialogService } from 'primeng/dynamicdialog';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { MeetingComposerFormService } from '../meeting-composer-form.service';
import { ComposerGuestsComponent } from './composer-guests.component';

describe('ComposerGuestsComponent', () => {
  let fixture: ComponentFixture<ComposerGuestsComponent>;
  let component: ComposerGuestsComponent;
  let formService: MeetingComposerFormService;
  let announce: ReturnType<typeof vi.fn>;

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
    announce = vi.fn().mockResolvedValue(undefined);
    TestBed.configureTestingModule({
      providers: [
        { provide: LiveAnnouncer, useValue: { announce } },
        MeetingComposerFormService,
        ConfirmationService,
        { provide: MessageService, useValue: { add: vi.fn() } },
        { provide: DialogService, useValue: { open: vi.fn() } },
        { provide: CommitteeService, useValue: {} },
        { provide: ProjectContextService, useValue: { activeContextUid: () => null } },
        {
          provide: MeetingService,
          useValue: {
            createRegistrantFormGroup: () => new FormGroup({ email: new FormControl(''), first_name: new FormControl(''), last_name: new FormControl('') }),
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

  describe('meeting host toggle', () => {
    const directGuest: MeetingRegistrantWithState = { ...savedGroupGuest, uid: 'registrant-2', email: 'direct@example.com', type: 'direct' };

    it('promotes a saved guest and queues an update for them', () => {
      formService.setGuests([directGuest, savedGroupGuest]);

      component['onToggleHost'](directGuest);

      const toggled = formService.guests().find((guest) => guest.uid === 'registrant-2');
      expect(toggled?.host).toBe(true);
      expect(toggled?.state).toBe('modified');
      expect(formService.registrantUpdates().toUpdate.map((update) => update.uid)).toEqual(['registrant-2']);
    });

    it('leaves every other guest untouched', () => {
      formService.setGuests([directGuest, savedGroupGuest]);

      component['onToggleHost'](directGuest);

      const other = formService.guests().find((guest) => guest.uid === 'registrant-1');
      expect(other?.host).toBe(false);
      expect(other?.state).toBe('existing');
    });

    it('demotes a saved host', () => {
      const host = { ...directGuest, host: true };
      formService.setGuests([host]);

      component['onToggleHost'](host);

      expect(formService.guests()[0].host).toBe(false);
      expect(formService.guests()[0].state).toBe('modified');
    });

    it('keeps an unsaved guest new so the flag rides along with the create', () => {
      const pending: MeetingRegistrantWithState = { ...directGuest, uid: '', tempId: 'temp_1', state: 'new' };
      formService.setGuests([pending]);

      component['onToggleHost'](pending);

      expect(formService.guests()[0].host).toBe(true);
      expect(formService.guests()[0].state).toBe('new');
      expect(formService.registrantUpdates().toUpdate).toHaveLength(0);
      expect(formService.registrantUpdates().toAdd).toHaveLength(1);
    });
  });

  /**
   * Covers the two things the projected rows have to get right for the list to behave: a `track` key
   * that never repeats, and a remove button that says which guest it removes. Both only go wrong on
   * registrants the happy path doesn't produce — a duplicated email, a missing name — so neither is
   * reachable from the reconciliation tests above.
   */
  describe('invited list filter', () => {
    const named = (uid: string, first: string, last: string, email: string): MeetingRegistrantWithState => ({
      ...savedGroupGuest,
      uid,
      first_name: first,
      last_name: last,
      email,
      type: 'direct',
    });
    const filterTo = (term: string): string[] => {
      component['guestFilterForm'].controls.query.setValue(term);
      return component['filteredGuestRows']().map((row) => row.guest.uid);
    };

    beforeEach(() => {
      formService.setGuests([named('r-anna', 'Anna', 'Kowalski', 'anna.kowalski@fabrikam.example'), named('r-bob', 'Bob', 'Marino', 'bob@tailspin.example')]);
    });

    it('narrows from the first character by word start, not substring', () => {
      // "Bob Marino" contains an "a" but no word starts with one.
      expect(filterTo('a')).toEqual(['r-anna']);
      expect(filterTo('m')).toEqual(['r-bob']);
    });

    it('matches a typed or pasted email as a whole', () => {
      expect(filterTo('anna.kowalski@fab')).toEqual(['r-anna']);
      expect(filterTo('bob@tailspin.example')).toEqual(['r-bob']);
    });

    it('lists everyone for an empty term and no one for a miss', () => {
      expect(filterTo('  ')).toEqual(['r-anna', 'r-bob']);
      expect(filterTo('zz')).toEqual([]);
    });
  });

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

    it('names the guest in the host toggle and flips it with the host flag', () => {
      formService.setGuests([savedGroupGuest]);
      expect(rows()[0].hostLabel).toBe('Make Member One a meeting host');
      expect(rows()[0].hostTooltip).toBe('Make host');

      formService.setGuests([{ ...savedGroupGuest, host: true }]);
      expect(rows()[0].hostLabel).toBe('Remove Member One as meeting host');
      expect(rows()[0].hostTooltip).toBe('Remove host');
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

  describe('undoing a removal', () => {
    beforeEach(() => formService.mode.set('edit'));

    it('is not offered on a create, where nothing is invited yet', () => {
      formService.mode.set('create');
      formService.setGuests([savedGroupGuest]);

      component['onRemoveGuest'](savedGroupGuest);

      expect(component['removalBatch']()).toBeNull();
    });

    it('puts a never-saved guest back where it sat', () => {
      const first = { ...savedGroupGuest, uid: '', tempId: 'temp_1', email: 'a@example.com', type: 'direct' as const, state: 'new' as const };
      const second = { ...first, tempId: 'temp_2', email: 'b@example.com' };
      formService.setGuests([first, second]);

      component['onRemoveGuest'](first);
      expect(formService.guests().map((entry) => entry.email)).toEqual(['b@example.com']);

      component['onUndoRemove']();

      expect(formService.guests().map((entry) => entry.email)).toEqual(['a@example.com', 'b@example.com']);
      expect(component['removalBatch']()).toBeNull();
      expect(announce).toHaveBeenLastCalledWith('Member One restored to the guest list.', 'polite');
    });

    it('restores a saved group guest to its saved state and lifts the email suppression', () => {
      formService.setGuests([savedGroupGuest]);

      component['onRemoveGuest'](savedGroupGuest);
      expect(formService.guests()[0].state).toBe('deleted');
      expect(formService.suppressedGuestEmails().has('member@example.com')).toBe(true);

      component['onUndoRemove']();

      expect(formService.guests()).toEqual([savedGroupGuest]);
      expect(formService.suppressedGuestEmails().has('member@example.com')).toBe(false);
    });

    it('tells screen readers that Undo is available', () => {
      formService.setGuests([savedGroupGuest]);

      component['onRemoveGuest'](savedGroupGuest);

      expect(announce).toHaveBeenCalledWith('Member One removed from the guest list. Undo is available above the list.', 'polite');
    });

    it('withdraws undo once a group puts the same email back, instead of duplicating it', () => {
      const direct = { ...savedGroupGuest, type: 'direct' as const };
      formService.setGuests([direct]);
      component['onRemoveGuest'](direct);

      // A group picked afterwards re-adds the person: removed direct guests are not suppressed.
      reconcile([member]);
      expect(component['undoBatch']()).toBeNull();

      component['onUndoRemove']();

      const live = formService.guests().filter((entry) => entry.state !== 'deleted' && entry.email === 'member@example.com');
      expect(live).toHaveLength(1);
    });

    it('keeps undo when another row already shared the email, such as a registration for another occurrence', () => {
      const thisOccurrence = { ...savedGroupGuest, uid: 'occ-a', type: 'direct' as const, occurrence_id: '1893456000' };
      const otherOccurrence = { ...thisOccurrence, uid: 'occ-b', occurrence_id: '1894060800' };
      formService.setGuests([thisOccurrence, otherOccurrence]);

      component['onRemoveGuest'](thisOccurrence);

      expect(component['undoBatch']()).not.toBeNull();
    });

    it('withdraws undo once the selected groups change, whatever the removed guest', () => {
      formService
        .form()
        .get('committees')
        ?.setValue([{ uid: 'committee-a' }]);
      const groupGuest = { ...savedGroupGuest, uid: '', tempId: 'temp_1', state: 'new' as const };
      formService.setGuests([groupGuest]);
      component['onRemoveGuest'](groupGuest);
      expect(component['undoBatch']()).not.toBeNull();

      formService
        .form()
        .get('committees')
        ?.setValue([{ uid: 'committee-b' }]);

      expect(component['undoBatch']()).toBeNull();
    });

    it('withdraws undo for a removed direct guest too when the groups change', () => {
      // The snapshot would overwrite whatever the group change did to the rows, so the batch goes whole.
      formService
        .form()
        .get('committees')
        ?.setValue([{ uid: 'committee-a' }]);
      const direct = { ...savedGroupGuest, uid: 'd-1', type: 'direct' as const };
      formService.setGuests([direct]);
      component['onRemoveGuest'](direct);
      expect(component['undoBatch']()).not.toBeNull();

      formService
        .form()
        .get('committees')
        ?.setValue([{ uid: 'committee-b' }]);

      expect(component['undoBatch']()).toBeNull();
    });

    it('withdraws undo when a group only re-attributes an unsaved guest', () => {
      const shared = { ...savedGroupGuest, uid: '', tempId: 'temp_shared', state: 'new' as const, committee_uid: 'committee-a', committee_name: 'Group A' };
      const other = { ...savedGroupGuest, uid: 'other-1', email: 'other@example.com', type: 'direct' as const };
      formService.setGuests([shared, other]);
      component['onRemoveGuest'](other);
      expect(component['undoBatch']()).not.toBeNull();

      // Group B's roster lands late and claims the shared guest; only the attribution fields change.
      reconcile([{ ...member, committee_uid: 'committee-b', committee_name: 'Group B' } as CommitteeMember]);

      expect(component['undoBatch']()).toBeNull();
    });

    it('offers undo for a guest with no email', () => {
      const emailless = { ...savedGroupGuest, uid: 'no-email', email: '', type: 'direct' as const };
      formService.setGuests([emailless]);

      component['onRemoveGuest'](emailless);

      expect(component['undoBatch']()).not.toBeNull();
    });

    it('withdraws undo once a voting-status filter narrows, whatever the removed guest', () => {
      formService
        .form()
        .get('committees')
        ?.setValue([{ uid: 'committee-a', allowed_voting_statuses: ['voting_rep', 'observer'] }]);
      formService.setGuests([savedGroupGuest]);
      component['onRemoveGuest'](savedGroupGuest);
      expect(component['undoBatch']()).not.toBeNull();

      formService
        .form()
        .get('committees')
        ?.setValue([{ uid: 'committee-a', allowed_voting_statuses: ['voting_rep'] }]);

      expect(component['undoBatch']()).toBeNull();
    });

    it('moves keyboard focus back to the restored row', () => {
      const focus = vi.spyOn(component as unknown as { focusGuestRemoveButton: (trackId: string | null) => void }, 'focusGuestRemoveButton');
      formService.setGuests([savedGroupGuest]);
      component['onRemoveGuest'](savedGroupGuest);

      component['onUndoRemove']();

      expect(focus).toHaveBeenCalledWith('registrant-1');
    });

    it('hands keyboard focus to the guest search when the undo notice is dismissed', () => {
      const focus = vi.spyOn(component as unknown as { focusGuestRemoveButton: (trackId: string | null) => void }, 'focusGuestRemoveButton');
      formService.setGuests([savedGroupGuest]);
      component['onRemoveGuest'](savedGroupGuest);

      component['onDismissUndo']();

      expect(component['undoBatch']()).toBeNull();
      expect(focus).toHaveBeenCalledWith(null);
    });

    it('hands focus to the next row after a removal, then the previous one, then the search', () => {
      const focus = vi.spyOn(component as unknown as { focusGuestRemoveButton: (trackId: string | null) => void }, 'focusGuestRemoveButton');
      const first = { ...savedGroupGuest, uid: 'g-1', email: 'one@example.com', type: 'direct' as const };
      const second = { ...first, uid: 'g-2', email: 'two@example.com' };
      formService.setGuests([first, second]);
      const live = (uid: string) => formService.guests().find((entry) => entry.uid === uid) as MeetingRegistrantWithState;

      component['onRemoveGuest'](live('g-1'));
      expect(focus).toHaveBeenLastCalledWith('g-2');

      component['onRemoveGuest'](live('g-2'));
      expect(focus).toHaveBeenLastCalledWith(null);
    });

    it('skips rows without a remove button when handing focus on', () => {
      const focus = vi.spyOn(component as unknown as { focusGuestRemoveButton: (trackId: string | null) => void }, 'focusGuestRemoveButton');
      const target = { ...savedGroupGuest, uid: 'g-1', email: 'one@example.com', type: 'direct' as const };
      const blocked = { ...target, uid: 'g-2', email: 'two@example.com' };
      const next = { ...target, uid: 'g-3', email: 'three@example.com' };
      formService.setGuests([target, blocked, next]);
      // Stand-in for a series-wide guest in an occurrence edit, which renders no remove button.
      vi.spyOn(component as unknown as { filteredGuestRows: () => ComposerGuestRow[] }, 'filteredGuestRows').mockReturnValue(
        component['guestRows']().map((row) => ({ ...row, removable: row.guest.uid !== 'g-2' }))
      );

      component['onRemoveGuest'](component['guestRows']()[0].guest);

      expect(focus).toHaveBeenLastCalledWith('g-3');
    });

    it('collects several removals into one notice and puts them all back together', () => {
      const first = { ...savedGroupGuest, uid: 'g-1', email: 'one@example.com', type: 'direct' as const };
      const second = { ...first, uid: 'g-2', email: 'two@example.com', first_name: 'Second' };
      const third = { ...first, uid: 'g-3', email: 'three@example.com', first_name: 'Third' };
      formService.setGuests([first, second, third]);

      component['onRemoveGuest'](first);
      expect(component['undoMessage']()).toBe('Member One removed.');
      component['onRemoveGuest'](formService.guests()[2]);
      expect(component['undoMessage']()).toBe('2 guests removed.');

      component['onUndoRemove']();

      expect(formService.guests()).toEqual([first, second, third]);
      expect(component['removalBatch']()).toBeNull();
      expect(announce).toHaveBeenLastCalledWith('2 guests restored to the guest list.', 'polite');
    });

    it('withdraws undo for every removal of an email a group puts back, not just the latest', () => {
      // Two registrations sharing an email, e.g. for two occurrences, both removed before a group re-adds it.
      const a = { ...savedGroupGuest, uid: 'reg-a', type: 'direct' as const, occurrence_id: '1893456000' };
      const b = { ...a, uid: 'reg-b', occurrence_id: '1894060800' };
      formService.setGuests([a, b]);
      component['onRemoveGuest'](a);
      component['onRemoveGuest'](formService.guests()[1]);
      expect(component['undoBatch']()?.labels).toHaveLength(2);

      reconcile([member]);

      expect(component['undoBatch']()).toBeNull();
    });

    it('starts a fresh batch after a group re-add, so undo cannot duplicate the re-added guest', () => {
      const direct = { ...savedGroupGuest, type: 'direct' as const };
      formService.setGuests([direct]);
      component['onRemoveGuest'](direct);
      reconcile([member]);
      const groupRow = formService.guests().find((entry) => entry.state === 'new') as MeetingRegistrantWithState;

      component['onRemoveGuest'](groupRow);
      component['onUndoRemove']();

      const live = formService.guests().filter((entry) => entry.state !== 'deleted' && entry.email === 'member@example.com');
      expect(live).toHaveLength(1);
    });

    it('withdraws the whole batch rather than undoing part of it in the wrong place', () => {
      const make = (n: number) => ({
        ...savedGroupGuest,
        uid: '',
        tempId: `temp_${n}`,
        email: `g${n}@example.com`,
        type: 'direct' as const,
        state: 'new' as const,
      });
      const saved = { ...savedGroupGuest, uid: 'saved-c', email: 'c@example.com', type: 'direct' as const };
      const a = { ...make(1), email: 'member@example.com' };
      const b = make(2);
      formService.setGuests([a, b, saved]);
      component['onRemoveGuest'](b);
      component['onRemoveGuest'](a);

      reconcile([member]);

      expect(component['undoBatch']()).toBeNull();
    });

    it('puts several never-saved guests back in their original order', () => {
      const make = (n: number) => ({
        ...savedGroupGuest,
        uid: '',
        tempId: `temp_${n}`,
        email: `g${n}@example.com`,
        type: 'direct' as const,
        state: 'new' as const,
      });
      const guests = [make(1), make(2), make(3), make(4)];
      formService.setGuests(guests);

      component['onRemoveGuest'](guests[1]);
      component['onRemoveGuest'](guests[3]);
      component['onRemoveGuest'](guests[0]);
      expect(formService.guests().map((entry) => entry.tempId)).toEqual(['temp_3']);

      component['onUndoRemove']();

      expect(formService.guests().map((entry) => entry.tempId)).toEqual(['temp_1', 'temp_2', 'temp_3', 'temp_4']);
    });

    it('stops offering undo once another guest is added', () => {
      formService.setGuests([savedGroupGuest]);
      component['onRemoveGuest'](savedGroupGuest);

      component['addDirectGuest']({ email: 'ada@example.com', first_name: 'Ada', last_name: 'Byron' });

      expect(component['removalBatch']()).toBeNull();
    });
  });

  describe('adding and removing without a confirm step', () => {
    it('puts a valid search pick straight onto the list, resets the search and announces it', () => {
      component['quickAddForm'].setValue({ email: 'ada@example.com', first_name: 'Ada', last_name: 'Byron' });

      component['onUserSelected']();

      expect(formService.guests().map((entry) => entry.email)).toEqual(['ada@example.com']);
      expect(component['quickAddForm'].value.email).toBeFalsy();
      expect(announce).toHaveBeenCalledWith('Ada Byron added to the guest list.', 'polite');
    });

    it('announces a removal, falling back to the email when the guest has no name', () => {
      const guest = { ...savedGroupGuest, uid: 'registrant-2', first_name: '', last_name: '', type: 'direct' as const };
      formService.setGuests([guest]);

      component['onRemoveGuest'](guest);

      expect(announce).toHaveBeenCalledWith('member@example.com removed from the guest list.', 'polite');
    });

    it('announces every one of two consecutive changes that read the same', () => {
      // Two guests sharing a name: a bound region would hold the same text and stay silent the second time.
      const first = { ...savedGroupGuest, uid: 'registrant-2', email: 'a@example.com', type: 'direct' as const };
      const second = { ...first, uid: 'registrant-3', email: 'b@example.com' };
      formService.setGuests([first, second]);

      component['onRemoveGuest'](first);
      component['onRemoveGuest'](second);

      expect(announce).toHaveBeenCalledTimes(2);
      expect(announce).toHaveBeenNthCalledWith(2, 'Member One removed from the guest list.', 'polite');
    });
  });

  /**
   * Covers what this section hands the group picker as the organizer's saved sharing decision.
   * @description The picker mounts after the load has settled, so it never sees the hydration
   * emission and cannot tell a create nobody touched from a meeting saved with sharing off. This
   * computed is the only thing that tells it apart.
   */
  describe('saved attendee visibility passed to the group picker', () => {
    const resolve = (meeting: Partial<Meeting> | null): boolean | null => {
      formService.meeting.set(meeting ? ({ meeting_type: 'Technical', restricted: false, ...meeting } as Meeting) : null);
      return component['savedAttendeeVisibility']();
    };

    it('reports no decision while creating, where there is no saved meeting', () => {
      expect(resolve(null)).toBeNull();
    });

    it('reports no decision for a board meeting carrying a stale opt-in', () => {
      expect(resolve({ meeting_type: 'Board', show_meeting_attendees: true })).toBeNull();
    });

    it('reports a restricted meeting as decided off, so a group default cannot switch sharing on', () => {
      expect(resolve({ restricted: true, show_meeting_attendees: true })).toBe(false);
    });

    it('reports an opt-out for a meeting whose flag the API omitted', () => {
      expect(resolve({ show_meeting_attendees: undefined })).toBe(false);
    });

    it('reports the saved opt-in of an unlocked meeting', () => {
      expect(resolve({ show_meeting_attendees: true })).toBe(true);
    });
  });

  /**
   * Editing one occurrence: the list shows who attends it, a guest invited to every occurrence can't be
   * removed from just this one (upstream has no exclusion), and one invited to this occurrence alone can.
   */
  describe('single-occurrence edit', () => {
    const THIS_OCCURRENCE = '1893456000';
    const seriesGuest: MeetingRegistrantWithState = { ...savedGroupGuest, uid: 'series-1', email: 'series@example.com', type: 'direct' };
    const thisOccurrenceGuest: MeetingRegistrantWithState = { ...seriesGuest, uid: 'occ-1', email: 'occ@example.com', occurrence_id: THIS_OCCURRENCE };
    const otherOccurrenceGuest: MeetingRegistrantWithState = { ...seriesGuest, uid: 'other-1', email: 'other@example.com', occurrence_id: '1894060800' };

    beforeEach(() => {
      formService.mode.set('edit');
      formService.occurrenceId.set(THIS_OCCURRENCE);
      formService.setGuests([seriesGuest, thisOccurrenceGuest, otherOccurrenceGuest]);
    });

    it("lists series-wide guests and this occurrence's guests, not other occurrences'", () => {
      expect(component['guestRows']().map((row) => row.guest.uid)).toEqual(['series-1', 'occ-1']);
    });

    it("labels the scope and only lets this occurrence's guests be removed", () => {
      const rows = component['guestRows']();

      expect(rows.map((row) => [row.scopeLabel, row.removable])).toEqual([
        ['All occurrences', false],
        ['This occurrence', true],
      ]);
    });

    it('matches this occurrence across the seconds and milliseconds id forms', () => {
      formService.setGuests([{ ...thisOccurrenceGuest, occurrence_id: `${THIS_OCCURRENCE}000` }]);

      expect(component['guestRows']().map((row) => row.guest.uid)).toEqual(['occ-1']);
    });
  });

  it('shows no scope labels and keeps every guest removable outside an occurrence edit', () => {
    formService.setGuests([savedGroupGuest]);

    expect(component['guestRows']().map((row) => [row.scopeLabel, row.removable])).toEqual([[null, true]]);
  });
});
