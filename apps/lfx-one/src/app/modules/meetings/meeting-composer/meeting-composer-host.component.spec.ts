// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpErrorResponse, provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { computed, signal, type WritableSignal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
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
import { DialogService } from 'primeng/dynamicdialog';
import { Drawer } from 'primeng/drawer';
import { of, Subject, throwError } from 'rxjs';
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

  /**
   * Opens an edit and stages the meeting-scoped answer the write-access guard falls back on. The
   * stub's payload says `organizer: true` — anything else is refused at load and never hydrates —
   * so the patch below overwrites that answer after hydration rather than arriving through the
   * fetch. What is being exercised is the guard re-reading the loaded meeting, not the load itself.
   */
  const openEdit = async (patch: Partial<Meeting>): Promise<void> => {
    composer.open({ mode: 'edit', meetingUid: 'meeting-1', projectUid: 'project-1' });
    await flush();
    formService.meeting.update((meeting) => ({ ...(meeting as Meeting), ...patch }));
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
            getMeeting: vi.fn(() =>
              of({ id: 'meeting-1', title: 'Weekly sync', organizer: true, start_time: '2030-01-08T15:00:00Z', timezone: 'America/New_York' })
            ),
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

    it('keeps an edit open when the project grant goes but the meeting still names the user an organizer', async () => {
      // The project-level signal is not what an edit is authorized on: the meeting's own `organizer`
      // relation is, and losing a project writer or coordinator grant leaves that relation untouched.
      // Closing here would discard a draft the upstream save still accepts.
      await openEdit({ organizer: true });

      setWriteAccess({ canWrite: false });
      await flush();

      expect(composer.isOpen()).toBe(true);
    });

    it('closes an edit when the meeting has no organizer grant of its own to fall back on', async () => {
      // The other half of the same question: with the project grant gone and the meeting answering
      // no, nothing authorizes the save, and closing is what the loss means.
      await openEdit({ organizer: false });

      setWriteAccess({ canWrite: false });
      await flush();

      expect(composer.isOpen()).toBe(false);
    });

    it('leaves an edit open when the grant goes while the meeting is still loading', async () => {
      // The third state, between the two above: the meeting has no answer yet. `editAuthorityStands`
      // reads the loaded payload, which does not exist until the fetch resolves, so for the length of
      // that fetch its absence is indistinguishable from a no — and a revocation landing in the window
      // would close a composer over a meeting that may well authorize it, on nothing but timing.
      // Waiting costs nothing, because a load that does come back `organizer: false` is refused by the
      // load path and lands on its own "you don't have permission" panel rather than staying open.
      const hydration = new Subject<Meeting>();
      (TestBed.inject(MeetingService).getMeeting as unknown as ReturnType<typeof vi.fn>).mockReturnValue(hydration);

      composer.open({ mode: 'edit', meetingUid: 'meeting-1', projectUid: 'project-1' });
      await flush();
      // The window is the test: without this the case degrades into the hydrated one above.
      expect(formService.meeting()).toBeNull();

      setWriteAccess({ canWrite: false });
      await flush();

      expect(composer.isOpen()).toBe(true);
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
      formService.form().patchValue({ title: 'Quarterly sync', startDate: new Date('2026-11-04T00:00:00Z'), startTime: '10:00 AM' });

      component['onSwitchToAdvanced']();
      await flush();

      expect(composer.isOpen()).toBe(true);
      expect(formService.form().get('startTime')?.value).toBe('10:00 AM');
    });
  });
});

/**
 * Covers what an organizer actually sees when the edit-mode fetch is refused, rather than what the
 * form service records about it.
 *
 * `meeting-composer-form.service.spec.ts` already pins the classification — a 403 sets
 * `meetingLoadFailure()` to `'denied'` and the retry is refused. Nothing pinned the half that reaches
 * the screen: that the denied copy is the copy rendered, and that the Try again button is genuinely
 * absent rather than merely disabled. Those are two different `@if` arms in the host template, and
 * swapping them would leave every existing assertion green while offering a revoked organizer a retry
 * that the service is built to ignore.
 *
 * This is the only form this case can take. The E2E route is closed: the meeting card probes with
 * `getMeetingDetail(uid, { skipCache: true })` before it opens anything, and that path *writes* the
 * fresh response into the detail cache, which `MeetingService.getMeeting` then reads for the composer's
 * own load. Inside `MEETING_DETAIL_CACHE_TTL_MS` the composer never issues a second request, so a
 * browser test cannot serve 200-then-403 and reach this screen through the UI.
 *
 * Unlike the suite above, this one keeps the real template — that is the whole point — and renders it
 * in the one state where it is cheap to mount: with the load failed the rail, the preview and all five
 * section components are switched off, leaving the drawer chrome and the error block.
 */
describe('MeetingComposerHostComponent — a refused edit load', () => {
  let fixture: ComponentFixture<MeetingComposerHostComponent>;
  let composer: MeetingComposerService;
  let getMeeting: ReturnType<typeof vi.fn>;

  const flush = async (): Promise<void> => {
    fixture.detectChanges();
    await fixture.whenStable();
  };

  // Looked up on the document, not the fixture: `p-drawer` renders its panel into an overlay outside
  // the host element, so a fixture-scoped query finds nothing even with the drawer fully open.
  const errorText = (): string => document.querySelector('[data-testid="meeting-composer-load-error"]')?.textContent ?? '';
  const retryButton = (): HTMLElement | null => document.querySelector('[data-testid="meeting-composer-load-retry"]');

  /** Opens the composer over a meeting whose fetch fails with `status`, and settles the drawer. */
  async function openEditFailingWith(status: number): Promise<void> {
    getMeeting.mockReturnValue(throwError(() => new HttpErrorResponse({ status, statusText: status === 403 ? 'Forbidden' : 'Server Error' })));
    composer.open({ mode: 'edit', meetingUid: 'meeting-1', projectUid: 'project-1' });
    await flush();
  }

  beforeEach(async () => {
    getMeeting = vi.fn();

    TestBed.configureTestingModule({
      providers: [
        // The host's own provider list reaches `SearchService`, which injects `HttpClient`. Testing
        // backend rather than the real one: nothing in this suite should be able to leave for the
        // network, and every service the error path touches is already stubbed below.
        provideHttpClient(),
        provideHttpClientTesting(),
        // `p-drawer` binds synthetic animation listeners, which throw without an animations module.
        provideNoopAnimations(),
        // The real service, not a double: this suite renders the template, and `p-toast` subscribes
        // to `messageObserver` on init — a stub with only `add`/`clear` fails the drawer's first
        // change detection before the error block is ever reached.
        MessageService,
        { provide: CommitteeService, useValue: {} },
        {
          provide: MeetingService,
          useValue: {
            getMeeting,
            getMeetingAttachments: vi.fn(() => of([])),
            getMeetingRegistrants: vi.fn(() => of([])),
            getMeetingDetail: vi.fn(() => of(null)),
          },
        },
        {
          provide: ProjectContextService,
          useValue: {
            meetingWriteAccess: signal<MeetingWriteAccess>({ contextUid: 'project-1', canWrite: true }),
            canWriteMeetings: signal(true),
            activeContextUid: signal('project-1'),
          },
        },
        { provide: PersonaService, useValue: { currentPersona: signal('maintainer') } },
        { provide: ProjectService, useValue: {} },
        { provide: LensService, useValue: { clearContextLens: vi.fn() } },
        { provide: Router, useValue: { events: new Subject(), url: '/meetings', parseUrl: () => ({ queryParams: {} }) } },
      ],
    });
    // `add`, not `set`: the real template is the subject here. The override still has to exist —
    // the template defers, so the build hangs async metadata off the component, and
    // `compileComponents` only awaits that for components already in the override queue.
    TestBed.overrideComponent(MeetingComposerHostComponent, { add: { providers: [] } });
    await TestBed.compileComponents();

    fixture = TestBed.createComponent(MeetingComposerHostComponent);
    composer = TestBed.inject(MeetingComposerService);
    await flush();
  });

  it('tells a revoked organizer their access is gone, not that the request broke', async () => {
    await openEditFailingWith(403);

    expect(errorText()).toContain("You don't have permission to edit this meeting");
    expect(errorText()).not.toContain('Something went wrong');
  });

  it('offers no Try again on a denial, because retrying cannot change the answer', async () => {
    await openEditFailingWith(403);

    // Absent, not disabled. The service refuses a retry after a denial, so a button here would look
    // like a way out of a state it cannot move — and the error block above is already on screen, so
    // this count cannot pass against an unrendered drawer.
    expect(errorText()).not.toBe('');
    expect(retryButton()).toBeNull();
  });

  it('keeps Try again on an ordinary failure, and refetches when it is pressed', async () => {
    await openEditFailingWith(500);

    expect(errorText()).toContain('Something went wrong loading this meeting');
    const retry = retryButton();
    expect(retry).not.toBeNull();

    getMeeting.mockClear();
    retry!.querySelector('button')!.click();
    await flush();

    // The contrast with the denial case is the assertion: this arm exists because the request can
    // succeed on a second try, so the button has to actually issue one.
    expect(getMeeting).toHaveBeenCalledWith('meeting-1');
  });
});

/**
 * Covers the freeze the composer goes into for the length of a save.
 *
 * `submit()` prepares the meeting payload before the request leaves, and guests and resources are
 * written after it resolves — so the two halves of one save read the form at two different moments. A
 * title typed while the request is in flight is dropped without a word; a guest added in the same
 * second is kept. Rather than reconcile that, the composer stops accepting input at all until the save
 * settles, and stops offering the four ways out (Cancel, the X, Escape, the backdrop) that would
 * otherwise read as a cancel while the write goes through anyway.
 *
 * Asserted on a real render: every one of these is a template binding, and the whole point is what the
 * organizer can still reach with the mouse and the keyboard.
 */
describe('MeetingComposerHostComponent — frozen while a save is in flight', () => {
  let fixture: ComponentFixture<MeetingComposerHostComponent>;
  let composer: MeetingComposerService;
  let formService: MeetingComposerFormService;

  const flush = async (): Promise<void> => {
    fixture.detectChanges();
    await fixture.whenStable();
  };

  // Queried off the document: `p-drawer` renders its panel into an overlay outside the host element,
  // so a fixture-scoped lookup finds nothing even with the drawer fully open.
  const body = (): HTMLElement | null => document.querySelector('[data-testid="meeting-composer-body"]');
  const cancelButton = (): HTMLButtonElement | null => document.querySelector('[data-testid="meeting-composer-cancel"] button');
  const createButton = (): HTMLButtonElement | null => document.querySelector('[data-testid="meeting-composer-create"] button');
  const backButton = (): HTMLButtonElement | null => document.querySelector('[data-testid="meeting-composer-back"] button');
  const closeIcon = (): HTMLElement | null => document.querySelector('.p-drawer-close-button');

  /** The live `p-drawer`, so the three dismissal inputs can be read as PrimeNG resolved them. */
  const drawer = (): Drawer => fixture.debugElement.query(By.directive(Drawer)).componentInstance;

  beforeEach(async () => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        // `p-drawer` binds synthetic animation listeners, which throw without an animations module.
        provideNoopAnimations(),
        // The real service: `p-toast` subscribes to `messageObserver` on init, and a stub without it
        // fails the drawer's first change detection before any of this is on screen.
        MessageService,
        { provide: CommitteeService, useValue: { getCommittees: vi.fn(() => of([])) } },
        {
          provide: MeetingService,
          useValue: {
            getMeeting: vi.fn(() => of(null)),
            getMeetingAttachments: vi.fn(() => of([])),
            getMeetingRegistrants: vi.fn(() => of([])),
            getMeetingDetail: vi.fn(() => of(null)),
          },
        },
        {
          provide: ProjectContextService,
          useValue: {
            meetingWriteAccess: signal<MeetingWriteAccess>({ contextUid: 'project-1', canWrite: true }),
            canWriteMeetings: signal(true),
            activeContextUid: signal('project-1'),
          },
        },
        { provide: PersonaService, useValue: { currentPersona: signal('maintainer') } },
        { provide: ProjectService, useValue: {} },
        // Agenda & Resources opens its template picker through this, and the last section is the
        // only one that renders the Create meeting button the footer test needs on screen.
        { provide: DialogService, useValue: { open: vi.fn() } },
        { provide: LensService, useValue: { clearContextLens: vi.fn() } },
        { provide: Router, useValue: { events: new Subject(), url: '/meetings', parseUrl: () => ({ queryParams: {} }) } },
      ],
    });
    // `add`, not `set`: the real template is the subject. The override still has to exist — the
    // template defers, so the build hangs async metadata off the component, and `compileComponents`
    // only awaits that for components already in the override queue.
    TestBed.overrideComponent(MeetingComposerHostComponent, { add: { providers: [] } });
    await TestBed.compileComponents();

    fixture = TestBed.createComponent(MeetingComposerHostComponent);
    composer = TestBed.inject(MeetingComposerService);
    // Off the component's own injector, not the TestBed's: the host declares
    // `providers: [MeetingComposerFormService]`, so one form lives per open composer and the module
    // injector has never heard of it. `TestBed.inject` would throw NG0201 — and a second instance
    // registered at module level would let `submitting` be flipped on a service the template is not
    // reading, so every assertion below would pass or fail for the wrong reason.
    formService = fixture.debugElement.injector.get(MeetingComposerFormService);
    await flush();

    composer.open({ mode: 'create', projectUid: 'project-1' });
    await flush();
  });

  it('leaves the form editable and every way out open while nothing is saving', async () => {
    expect(body()?.hasAttribute('inert')).toBe(false);
    expect(cancelButton()?.disabled).toBe(false);
    expect(closeIcon()).not.toBeNull();
    expect(drawer().dismissible).toBe(true);
    expect(drawer().closeOnEscape).toBe(true);
  });

  it('makes the whole form inert once the save is in flight', async () => {
    formService.submitting.set(true);
    await flush();

    // `inert`, not a disabled pass over the controls: it takes the fields out of the focus order and
    // out of the accessibility tree in one attribute, and it covers the sections that are not
    // currently rendered by the section switcher just as well as the one that is.
    expect(body()?.hasAttribute('inert')).toBe(true);
  });

  it('closes the four ways out for the length of the save', async () => {
    formService.submitting.set(true);
    await flush();

    // Cancel and the X first: both call `close()`, which does not cancel the request — it would leave
    // the organizer looking at a dismissed composer while the write lands behind it.
    expect(cancelButton()?.disabled).toBe(true);
    expect(closeIcon()).toBeNull();
    // Then the two PrimeNG defaults, which are `true` unless bound: a backdrop click and Escape reach
    // `close()` by the same route without ever touching a control this suite can see.
    expect(drawer().dismissible).toBe(false);
    expect(drawer().closeOnEscape).toBe(false);
  });

  it('keeps Create meeting reachable, because the spinner lives on it', async () => {
    // The last section, because that is the only one that renders Create meeting — every earlier one
    // ends in Next, and a save can only be in flight from here.
    composer.setSection(MEETING_COMPOSER_SECTIONS[MEETING_COMPOSER_SECTIONS.length - 1].id);
    await flush();
    formService.submitting.set(true);
    await flush();

    // The footer sits outside the inert container on purpose. A freeze that swallowed the button the
    // organizer just pressed would take its loading state with it and leave the save looking dead.
    const create = createButton();
    expect(create).not.toBeNull();
    expect(create!.closest('[inert]')).toBeNull();
  });

  it('locks Back too, so the save cannot be navigated away from', async () => {
    const lastSection = MEETING_COMPOSER_SECTIONS[MEETING_COMPOSER_SECTIONS.length - 1];
    composer.setSection(lastSection.id);
    await flush();
    formService.submitting.set(true);
    await flush();

    // Back is the one control left in the footer that still moves sections. Leaving the last section
    // mid-save unmounts Create meeting and the spinner on it, so the write looks like it stopped —
    // and the success handler then closes the composer from a section the organizer did not save on.
    expect(backButton()?.disabled).toBe(true);

    // And the handler refuses independently, for the keyboard activation that races the disable —
    // the same reason `onNext()` re-checks `canProceed()`.
    (fixture.componentInstance as unknown as { onBack: () => void }).onBack();
    await flush();

    expect(composer.activeSection()).toBe(lastSection.id);
  });

  it('gives the composer back the moment the save settles', async () => {
    formService.submitting.set(true);
    await flush();
    formService.submitting.set(false);
    await flush();

    // A failed save leaves the composer open with the organizer's work in it, so the freeze has to be
    // tied to the request and nothing else — a one-way latch would strand them on a retry.
    expect(body()?.hasAttribute('inert')).toBe(false);
    expect(cancelButton()?.disabled).toBe(false);
    expect(closeIcon()).not.toBeNull();
    expect(drawer().dismissible).toBe(true);
    expect(drawer().closeOnEscape).toBe(true);
  });
});
