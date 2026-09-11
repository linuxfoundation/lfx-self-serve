// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { computed, signal, type WritableSignal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { MEETING_COMPOSER_SECTIONS, MEETING_COMPOSER_TOAST_KEY } from '@lfx-one/shared/constants';
import type { Meeting, MeetingWriteAccess } from '@lfx-one/shared/interfaces';
import { CommitteeService } from '@services/committee.service';
import { LensService } from '@services/lens.service';
import { MeetingService } from '@services/meeting.service';
import { PersonaService } from '@services/persona.service';
import { ProjectContextService } from '@services/project-context.service';
import { ProjectService } from '@services/project.service';
import { MessageService } from 'primeng/api';
import { of, Subject } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { MeetingComposerFormService } from './meeting-composer-form.service';
import { MeetingComposerHostComponent } from './meeting-composer-host.component';
import { MeetingComposerService } from './meeting-composer.service';

/**
 * Covers the host's own decisions: which section the footer navigation lands on, when Save is allowed
 * to fire, what the post-create toast carries, and the two ways an open composer closes without the
 * organizer asking. None of it is reachable from the section specs — the host is the only place that
 * holds both composer services, and its `submit()` subscription is the single path between a saved
 * meeting and the toast that is now the only route back to it.
 */
describe('MeetingComposerHostComponent', () => {
  let fixture: ComponentFixture<MeetingComposerHostComponent>;
  let component: MeetingComposerHostComponent;
  let composer: MeetingComposerService;
  let formService: MeetingComposerFormService;
  let messageService: { add: ReturnType<typeof vi.fn>; clear: ReturnType<typeof vi.fn> };
  let meetingWriteAccess: WritableSignal<MeetingWriteAccess>;
  let currentPersona: WritableSignal<string>;
  let clearContextLens: ReturnType<typeof vi.fn>;

  const createdMeeting = { id: 'meeting-1', title: 'Weekly sync' } as Meeting;

  /** The `toObservable` bridges in the constructor emit on effect flush, so every signal write needs one. */
  const flush = async (): Promise<void> => {
    fixture.detectChanges();
    await fixture.whenStable();
  };

  const openCreate = async (): Promise<void> => {
    composer.open({ mode: 'create', projectUid: 'project-1' });
    await flush();
  };

  /** The minimum that clears `details-access`, which create mode now requires before Next moves. */
  const fillDetailsAccess = (): void => {
    formService.form().patchValue({ title: 'Weekly sync', meeting_type: 'Technical' });
  };

  /** The smallest set that satisfies every required control plus the group-level future-date validator. */
  const fillRequiredFields = (): void => {
    formService.form().patchValue({
      title: 'Weekly sync',
      meeting_type: 'Technical',
      startDate: new Date(2030, 0, 8),
      // `combineDateTime` parses a 12-hour string only; a 24-hour one returns '' and the validator passes
      // for the wrong reason.
      startTime: '10:00 AM',
      timezone: 'America/New_York',
    });
  };

  const lastToast = () => messageService.add.mock.calls[messageService.add.mock.calls.length - 1][0];
  const setWriteAccess = (patch: Partial<MeetingWriteAccess>) => meetingWriteAccess.update((current) => ({ ...current, ...patch }));

  beforeEach(async () => {
    messageService = { add: vi.fn(), clear: vi.fn() };
    meetingWriteAccess = signal<MeetingWriteAccess>({ contextUid: 'project-1', canWrite: true });
    currentPersona = signal('maintainer');
    clearContextLens = vi.fn();

    TestBed.configureTestingModule({
      providers: [
        { provide: MessageService, useValue: messageService },
        { provide: CommitteeService, useValue: {} },
        {
          provide: MeetingService,
          useValue: {
            getMeeting: vi.fn(() => of({ id: 'meeting-1', title: 'Weekly sync', start_time: '2030-01-08T15:00:00Z', timezone: 'America/New_York' })),
            getMeetingAttachments: vi.fn(() => of([])),
            getMeetingRegistrants: vi.fn(() => of([])),
            getMeetingDetail: vi.fn(() => of(null)),
          },
        },
        // `meetingWriteAccess` feeds `toObservable`, so it has to be a real signal rather than a
        // plain getter. It is the source here, with the two loose signals derived off it exactly as
        // the real service derives them — composing it the other way round would let a test stage a
        // uid and an answer separately, which is the state the pairing exists to make unreachable.
        {
          provide: ProjectContextService,
          useValue: {
            meetingWriteAccess,
            canWriteMeetings: computed(() => meetingWriteAccess().canWrite),
            activeContextUid: computed(() => meetingWriteAccess().contextUid),
          },
        },
        // The real service reads a cookie and an HTTP endpoint in its constructor; the host only ever
        // asks it which persona is active.
        { provide: PersonaService, useValue: { currentPersona } },
        // Only reached by the project-context fallback, which never runs while no meeting is loaded.
        { provide: ProjectService, useValue: {} },
        // The create picker's lens override is the only one the host ends; the real service reads
        // cookies and the router to work out a lens nothing here asks it for.
        { provide: LensService, useValue: { clearContextLens } },
        { provide: Router, useValue: { events: new Subject(), url: '/meetings', parseUrl: () => ({ queryParams: {} }) } },
      ],
    });
    // `set` replaces only the listed metadata keys, so the component's own `providers` survive and the
    // host still supplies the form service instance the tests read below.
    TestBed.overrideComponent(MeetingComposerHostComponent, { set: { template: '', imports: [] } });

    fixture = TestBed.createComponent(MeetingComposerHostComponent);
    component = fixture.componentInstance;
    composer = TestBed.inject(MeetingComposerService);
    // Component-provided, so `TestBed.inject` would hand back a second instance the host never reads.
    formService = fixture.debugElement.injector.get(MeetingComposerFormService);
    await flush();
  });

  describe('section navigation', () => {
    it('tracks the active section by position', () => {
      composer.setSection('platform-features');

      expect(component['activeIndex']()).toBe(2);
      expect(component['isLastSection']()).toBe(false);
      expect(component['activeSectionLabel']()).toBe('Platform & features');
    });

    it('reports the final section as last', () => {
      composer.setSection('agenda-resources');

      expect(component['isLastSection']()).toBe(true);
    });

    it('advances one section and records the visit', () => {
      fillDetailsAccess();

      component['onNext']();

      expect(composer.activeSection()).toBe(MEETING_COMPOSER_SECTIONS[1].id);
      expect(composer.visitedSections().has(MEETING_COMPOSER_SECTIONS[1].id)).toBe(true);
    });

    it('refuses to advance past a required section that still has holes in it', () => {
      component['onNext']();

      // The footer disables Next here, but the handler is also the keyboard path, and the rail
      // locks the same rows off the same number — neither control may be a way around the other.
      expect(composer.activeSection()).toBe('details-access');
    });

    it('does nothing when Next is reached on the last section', () => {
      composer.setSection('agenda-resources');

      component['onNext']();

      // The footer hides Next here, but the handler is also the keyboard path — walking off the end
      // would leave `activeIndex` at -1 and blank the header label.
      expect(composer.activeSection()).toBe('agenda-resources');
    });

    it('steps back one section', () => {
      composer.setSection('date-schedule');

      component['onBack']();

      expect(composer.activeSection()).toBe('details-access');
    });

    it('does nothing when Back is pressed on the first section', () => {
      component['onBack']();

      expect(composer.activeSection()).toBe('details-access');
    });

    it('jumps to the section that owns the title field', () => {
      composer.setSection('guests');

      component['onGoToTitleSection']();

      expect(composer.activeSection()).toBe('details-access');
    });
  });

  describe('closing', () => {
    it('closes the composer when the drawer reports itself hidden', async () => {
      await openCreate();

      component['onVisibleChange'](false);

      expect(composer.isOpen()).toBe(false);
    });

    it('leaves the composer open when the drawer reports itself visible', async () => {
      await openCreate();

      component['onVisibleChange'](true);

      expect(composer.isOpen()).toBe(true);
    });

    /**
     * The create picker can open this composer with a lens override standing in `LensService` — a
     * deliberate persona bypass, scoped to one flow, that every other branch of the picker ends by
     * navigating. This branch never navigates, so closing the overlay is the only end it gets.
     */
    it('ends the create picker lens override when the composer closes', async () => {
      await openCreate();
      expect(clearContextLens).not.toHaveBeenCalled();

      component['onVisibleChange'](false);
      await flush();

      expect(clearContextLens).toHaveBeenCalledTimes(1);
    });

    it('leaves the override alone while the composer is still open', async () => {
      await openCreate();
      await flush();

      // Nothing has ended yet: clearing here would drop the very override the picker set to make
      // this composer read the project it was opened against.
      expect(clearContextLens).not.toHaveBeenCalled();
    });

    it('closes an open composer when write access is lost', async () => {
      await openCreate();

      setWriteAccess({ canWrite: false });
      await flush();

      expect(composer.isOpen()).toBe(false);
    });

    it('leaves the composer open when write access only resolves late', async () => {
      // `canWriteMeetings` starts false in production and stays false while the grants request is
      // unresolved, so a deep-linked open would be closed under the organizer if any false counted
      // rather than only a true -> false. Drop to false before opening to reach that state.
      setWriteAccess({ canWrite: false });
      await flush();
      await openCreate();

      setWriteAccess({ canWrite: true });
      await flush();

      expect(composer.isOpen()).toBe(true);
    });

    it('leaves the composer open when the write-access answer changes with the project it answers for', async () => {
      // `syncEntityProjectContext` moves the context to the meeting's own project on a context-less
      // edit link. The new project answers the write question for itself, so a true -> false across
      // that move is a different question, not a lost grant — a committee writer editing a group
      // meeting, or anyone admitted on one project and editing a meeting in another, reaches false
      // here on an edit `writerGuard` had just admitted.
      await openCreate();

      meetingWriteAccess.set({ contextUid: 'project-2', canWrite: false });
      await flush();

      expect(composer.isOpen()).toBe(true);
    });

    it('closes on an executive director too, because the loss it saw was a real one', async () => {
      // No persona exemption here, unlike `evictOnWriteAccessLoss`. That helper fires on the first
      // false after boot, which an executive director admitted by `writerGuard`'s FGA-less fast path
      // produces with no grant ever having existed, so it has to exempt them. This pipe needs a
      // pairwise true -> false, which that same ED never reaches: with no grant the signal never
      // says true, and there is no transition. Reaching here means the grant was there and is gone,
      // and the upstream save has stopped accepting it whatever persona is on screen.
      currentPersona.set('executive-director');
      await openCreate();

      setWriteAccess({ canWrite: false });
      await flush();

      expect(composer.isOpen()).toBe(false);
    });
  });

  describe('submit gating', () => {
    it('blocks save while the create form is empty', async () => {
      await openCreate();

      expect(component['canSubmit']()).toBe(false);
    });

    it('allows save once every required field is answered', async () => {
      await openCreate();

      fillRequiredFields();

      expect(component['canSubmit']()).toBe(true);
    });

    it('ignores a submit while one is already in flight', async () => {
      await openCreate();
      const submit = vi.spyOn(formService, 'submit');
      formService.submitting.set(true);

      component['onSubmit']();

      expect(submit).not.toHaveBeenCalled();
    });

    it('ignores a submit the form validation rejects', async () => {
      await openCreate();
      const submit = vi.spyOn(formService, 'submit');
      vi.spyOn(formService, 'validateForSubmit').mockReturnValue(false);

      component['onSubmit']();

      expect(submit).not.toHaveBeenCalled();
    });
  });

  describe('post-create announcement', () => {
    beforeEach(async () => {
      await openCreate();
      vi.spyOn(formService, 'validateForSubmit').mockReturnValue(true);
    });

    it('raises a sticky keyed toast carrying the created meeting', () => {
      vi.spyOn(formService, 'submit').mockReturnValue(of(createdMeeting));

      component['onSubmit']();

      expect(lastToast()).toMatchObject({
        key: MEETING_COMPOSER_TOAST_KEY,
        severity: 'success',
        summary: 'Meeting created',
        detail: 'Weekly sync',
        sticky: true,
        closable: true,
        data: { meetingUid: 'meeting-1', meetingTitle: 'Weekly sync', meetingUrl: '/meetings/meeting-1' },
      });
      // A meeting with no password carries no navigation state at all, so the link is a plain route.
      expect(lastToast().data.meetingLinkState).toBeUndefined();
    });

    it('retires the previous announcement before raising its own', () => {
      vi.spyOn(formService, 'submit').mockReturnValue(of(createdMeeting));

      component['onSubmit']();

      // Sticky toasts never expire, so creating several meetings in a row would stack them over the page.
      expect(messageService.clear).toHaveBeenCalledWith(MEETING_COMPOSER_TOAST_KEY);
    });

    it('carries the password to the meeting link when the meeting has one', () => {
      vi.spyOn(formService, 'submit').mockReturnValue(of({ ...createdMeeting, password: 'secret' } as Meeting));

      component['onSubmit']();

      // Without it the join page bounces every private or restricted meeting to /meetings/not-found.
      // Router state, not a query param, so the shared secret never reaches the address bar.
      expect(lastToast().data.meetingLinkState).toEqual({ password: 'secret' });
    });

    it('names an untitled meeting rather than showing a blank toast', () => {
      vi.spyOn(formService, 'submit').mockReturnValue(of({ id: 'meeting-2' } as Meeting));

      component['onSubmit']();

      expect(lastToast().data.meetingTitle).toBe('Untitled meeting');
    });

    it('falls back to a plain confirmation when the create returns no meeting', () => {
      vi.spyOn(formService, 'submit').mockReturnValue(of(null));

      component['onSubmit']();

      // A keyed toast here would offer two actions that dead-end: there is no uid to link to.
      expect(lastToast()).toEqual({ severity: 'success', summary: 'Meeting created', detail: 'Open it from the list to review the details.' });
      expect(lastToast().key).toBeUndefined();
    });

    it('confirms an edit instead of announcing a creation', () => {
      formService.mode.set('edit');
      vi.spyOn(formService, 'submit').mockReturnValue(of(null));

      component['onSubmit']();

      expect(lastToast()).toMatchObject({ summary: 'Meeting updated', detail: 'Your changes have been saved.' });
    });

    it('records the save and closes the composer', () => {
      vi.spyOn(formService, 'submit').mockReturnValue(of(createdMeeting));

      component['onSubmit']();

      expect(composer.saveCount()).toBe(1);
      expect(composer.isOpen()).toBe(false);
    });

    it('acts once even if the save stream emits again', () => {
      vi.spyOn(formService, 'submit').mockReturnValue(of(createdMeeting, { id: 'meeting-2' } as Meeting));

      component['onSubmit']();

      // The handler closes the composer, so a second emission would announce a meeting over a surface
      // that has already moved on.
      expect(messageService.add).toHaveBeenCalledTimes(1);
      expect(composer.saveCount()).toBe(1);
    });
  });

  describe('editing from the toast', () => {
    it('refuses while another composer is open', async () => {
      await openCreate();

      expect(component['editFromToastBlockedReason']()).toBe('Close the open composer first');
    });

    it('allows the reopen once the composer is closed', () => {
      expect(component['editFromToastBlockedReason']()).toBeNull();
    });

    it('still offers the reopen when the ambient project reports no meeting-write access', () => {
      // The organizer of a group meeting is frequently not a writer or meeting coordinator on the
      // project they happen to be looking at, and `createMeeting` wrote them into the meeting's
      // own `organizers` regardless. Asking the project-level question here denied people the
      // meeting they had just made; the meeting-scoped answer lives on the path this action opens.
      setWriteAccess({ canWrite: false });

      expect(component['editFromToastBlockedReason']()).toBeNull();
    });

    it('does nothing when the action is blocked', async () => {
      await openCreate();

      component['onEditCreatedMeeting']({
        meetingUid: 'meeting-1',
        meetingTitle: 'Weekly sync',
        meetingUrl: '/meetings/meeting-1',
      });

      // Reopening here would silently discard the draft in the open composer.
      expect(composer.context()).toMatchObject({ mode: 'create' });
    });

    it('clears the toast and reopens the composer in edit mode', () => {
      component['onEditCreatedMeeting']({
        meetingUid: 'meeting-1',
        meetingTitle: 'Weekly sync',
        meetingUrl: '/meetings/meeting-1',
      });

      expect(messageService.clear).toHaveBeenCalledWith(MEETING_COMPOSER_TOAST_KEY);
      expect(composer.context()).toEqual({ mode: 'edit', meetingUid: 'meeting-1' });
    });
  });

  describe('switching a quick create to the drawer', () => {
    it('moves the surface without touching what was already entered', async () => {
      composer.open({ mode: 'create', projectUid: 'project-1', variant: 'quick' });
      await flush();
      const form = formService.form();
      form.patchValue({ title: 'Quarterly sync' });

      component['onSwitchToAdvanced']();
      await flush();

      // One form service instance feeds both surfaces, so the handoff has nothing to copy \u2014 what it
      // must not do is re-initialize, which would hand the organizer back an empty drawer.
      expect(composer.isQuickCreate()).toBe(false);
      expect(formService.form()).toBe(form);
      expect(formService.form().get('title')?.value).toBe('Quarterly sync');
    });

    // The dialog's own `visibleChange` closes the composer, and unmounting the dialog is exactly
    // what the handoff does. If that ever routes through `close()`, the drawer the organizer just
    // asked for never appears — so the open state is asserted separately from the form state.
    it('leaves the composer open so the drawer can take over', async () => {
      composer.open({ mode: 'create', projectUid: 'project-1', variant: 'quick' });
      await flush();
      formService.form().patchValue({ title: 'Quarterly sync', startDate: new Date('2026-11-04T00:00:00Z'), startTime: '10:00' });

      component['onSwitchToAdvanced']();
      await flush();

      expect(composer.isOpen()).toBe(true);
      expect(formService.form().get('startTime')?.value).toBe('10:00');
    });
  });
});
