// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MEETING_COMPOSER_SECTIONS } from '@lfx-one/shared/constants';
import type { MeetingComposerRailRow, MeetingComposerSectionId } from '@lfx-one/shared/interfaces';
import { CommitteeService } from '@services/committee.service';
import { MeetingService } from '@services/meeting.service';
import { PersonaService } from '@services/persona.service';
import { ProjectContextService } from '@services/project-context.service';
import { MessageService } from 'primeng/api';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MeetingComposerFormService } from './meeting-composer-form.service';
import { MeetingComposerRailComponent } from './meeting-composer-rail.component';
import { MeetingComposerService } from './meeting-composer.service';

/**
 * Covers the rail's reachability state machine.
 *
 * It is the only surface that can put the organizer on a section out of order, so it has to agree with
 * the footer's disabled Next in both directions: never open a section the footer wouldn't advance to,
 * and never lock one the footer would. Both halves of that — the "first invalid required section"
 * ceiling and the "one past the furthest visited" frontier — are asserted, because either one alone
 * still passes the obvious cases: with only the ceiling, clearing the two required sections unlocks all
 * three optional ones at once; with only the frontier, a blank required section is walkable past.
 *
 * The last block covers the compact chip row's auto-scroll, which is the one behavior here that is not
 * a pure function of the rows — it reads the rendered DOM.
 */
describe('MeetingComposerRailComponent', () => {
  let fixture: ComponentFixture<MeetingComposerRailComponent>;
  let composer: MeetingComposerService;
  let formService: MeetingComposerFormService;

  const rows = (): MeetingComposerRailRow[] => fixture.componentInstance['rows']();
  const row = (id: MeetingComposerSectionId): MeetingComposerRailRow => rows().find((candidate) => candidate.section.id === id)!;
  const reachableIds = (): MeetingComposerSectionId[] =>
    rows()
      .filter((candidate) => candidate.reachable)
      .map((candidate) => candidate.section.id);

  /**
   * Drops the template for the blocks that only read `rows()`.
   *
   * Called per block rather than in the shared `beforeEach` because the compact block below needs the
   * real markup — its subject is an `afterRenderEffect` that queries the rendered chip, so a stub would
   * leave it asserting against an empty DOM while looking like it covered something.
   */
  const stubTemplate = (): void => {
    TestBed.overrideComponent(MeetingComposerRailComponent, { set: { template: '', imports: [] } });
  };

  /**
   * Resolves the two services under test.
   *
   * Separate from the shared `beforeEach` because the first `inject` instantiates the test module and
   * `overrideComponent` throws after that — so a block that stubs its template has to stub before it
   * reaches for a service.
   */
  const injectServices = (): void => {
    composer = TestBed.inject(MeetingComposerService);
    formService = TestBed.inject(MeetingComposerFormService);
  };

  /** Fills what `details-access` validates, which is what unblocks everything after it. */
  const completeDetails = (): void => {
    formService.form().get('title')?.setValue('Composer meeting');
    formService.form().get('meeting_type')?.setValue('Board');
  };

  /** The same for `date-schedule`, which create mode leaves entirely to the organizer (GH-1454). */
  const completeSchedule = (): void => {
    formService
      .form()
      .get('startDate')
      ?.setValue(new Date(Date.now() + 7 * 24 * 60 * 60 * 1000));
    formService.form().get('startTime')?.setValue('10:00 AM');
    formService.form().get('timezone')?.setValue('UTC');
  };

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        MeetingComposerFormService,
        MeetingComposerService,
        { provide: MessageService, useValue: { add: vi.fn() } },
        { provide: CommitteeService, useValue: {} },
        { provide: MeetingService, useValue: {} },
        { provide: ProjectContextService, useValue: { activeContextUid: () => null } },
        { provide: PersonaService, useValue: { currentPersona: () => null } },
      ],
    });
  });

  describe('create mode', () => {
    beforeEach(() => {
      stubTemplate();
      injectServices();
      composer.open({ mode: 'create', projectUid: 'project-1' });
      formService.initialize({ mode: 'create', projectUid: 'project-1' });

      fixture = TestBed.createComponent(MeetingComposerRailComponent);
      fixture.detectChanges();
    });

    it('locks everything past the first required section while it is still empty', () => {
      // `platform-features` is valid from its own defaults, so a ceiling-only rule would already offer it.
      expect(formService.isSectionValid('platform-features')).toBe(true);
      expect(reachableIds()).toEqual(['details-access']);
    });

    it('unlocks only the next section once the first one validates', () => {
      completeDetails();

      // Not `platform-features`: nothing is invalid any more, so this is the frontier doing the work.
      expect(reachableIds()).toEqual(['details-access', 'date-schedule']);
    });

    it('advances the frontier one section per visit', () => {
      completeDetails();
      composer.setSection('date-schedule');
      completeSchedule();

      expect(reachableIds()).toEqual(['details-access', 'date-schedule', 'platform-features']);
    });

    it('re-locks the sections past a required one that was emptied again', () => {
      completeDetails();
      composer.setSection('date-schedule');
      completeSchedule();
      composer.setSection('platform-features');
      formService.form().get('title')?.setValue('');

      // Visited sections stay reachable up to the break, so the organizer can walk back to the field
      // that broke — but nothing past it opens, even though `platform-features` was visited.
      expect(reachableIds()).toEqual(['details-access']);
    });

    it('marks a section complete only after it has been visited', () => {
      completeDetails();
      completeSchedule();

      // Valid, but a check mark on a section nobody has opened claims work that did not happen.
      expect(row('date-schedule').complete).toBe(false);

      composer.setSection('date-schedule');
      composer.setSection('platform-features');

      expect(row('date-schedule').complete).toBe(true);
    });

    it('never marks the section being edited complete', () => {
      completeDetails();

      expect(row('details-access').active).toBe(true);
      expect(row('details-access').complete).toBe(false);
    });

    it('flags a visited required section that is still invalid, and nothing further ahead', () => {
      completeDetails();
      composer.setSection('date-schedule');
      formService.form().get('title')?.setValue('');

      expect(row('details-access').needsAttention).toBe(true);
      // Unvisited: reporting it as broken would describe the form as failing before it was filled.
      expect(row('agenda-resources').needsAttention).toBe(false);
    });

    it('ignores a click on an unreachable row and jumps on a reachable one', () => {
      completeDetails();

      fixture.componentInstance['onSelect'](row('agenda-resources'));
      expect(composer.activeSection()).toBe('details-access');

      fixture.componentInstance['onSelect'](row('date-schedule'));
      expect(composer.activeSection()).toBe('date-schedule');
    });

    it('marks the last row so the connector line stops there', () => {
      expect(rows().map((candidate) => candidate.isLast)).toEqual([false, false, false, false, true]);
    });
  });

  describe('edit mode', () => {
    beforeEach(() => {
      stubTemplate();
      injectServices();
      composer.open({ mode: 'edit', meetingUid: 'meeting-1' });
      // `initialize` is called without `meetingUid` on purpose: the fetch is what this test does not
      // want, and the rail reads mode, not the meeting.
      formService.initialize({ mode: 'edit' });

      fixture = TestBed.createComponent(MeetingComposerRailComponent);
      fixture.detectChanges();
    });

    it('leaves every section reachable however invalid the form is', () => {
      expect(formService.isSectionValid('details-access')).toBe(false);
      expect(reachableIds()).toEqual(MEETING_COMPOSER_SECTIONS.map((section) => section.id));
    });

    it('jumps to a section the create-mode rail would have locked', () => {
      fixture.componentInstance['onSelect'](row('agenda-resources'));

      expect(composer.activeSection()).toBe('agenda-resources');
    });
  });

  /**
   * The compact chip row's `afterRenderEffect`, which scrolls the active chip into view.
   *
   * `lg:hidden` is a CSS breakpoint, so at desktop widths the chip row is still in the DOM and the
   * component's query still finds the chip — the only thing separating "collapsed and visible" from
   * "present but hidden" is whether the element has been laid out. Getting that wrong is invisible in
   * the collapsed layout the feature was built for and yanks the desktop composer's scroll position
   * sideways on every section change, so both branches are pinned here.
   *
   * This block renders the real template: the subject is a DOM read, and both `getClientRects` and
   * `scrollIntoView` are patched on `Element.prototype` rather than on one node because the effect
   * resolves its own element after the render this test can't reach into.
   */
  describe('compact chip row', () => {
    const originalGetClientRects = Element.prototype.getClientRects;
    const originalScrollIntoView = Element.prototype.scrollIntoView;
    let scrolled: { testId: string | null; options: unknown }[];

    /** jsdom performs no layout, so both states are stated outright rather than left to the default. */
    const setLaidOut = (laidOut: boolean): void => {
      Element.prototype.getClientRects = () => (laidOut ? [new DOMRect(0, 0, 120, 32)] : []) as unknown as DOMRectList;
    };

    const renderRail = (compact: boolean): void => {
      fixture = TestBed.createComponent(MeetingComposerRailComponent);
      fixture.componentRef.setInput('compact', compact);
      // `TestBed.tick()` rather than `fixture.detectChanges()`: the latter runs this view's change
      // detection, and `afterRenderEffect` only flushes on an application tick.
      TestBed.tick();
    };

    beforeEach(() => {
      scrolled = [];
      // jsdom leaves `scrollIntoView` unimplemented, so this is a stand-in as much as a spy. The
      // element is recorded by test id because the assertion is about *which* chip moved.
      Element.prototype.scrollIntoView = function (options?: boolean | ScrollIntoViewOptions) {
        scrolled.push({ testId: (this as Element).getAttribute('data-testid'), options });
      };

      injectServices();
      composer.open({ mode: 'create', projectUid: 'project-1' });
      formService.initialize({ mode: 'create', projectUid: 'project-1' });
    });

    afterEach(() => {
      Element.prototype.getClientRects = originalGetClientRects;
      Element.prototype.scrollIntoView = originalScrollIntoView;
    });

    it('scrolls the active chip into view once the row is laid out', () => {
      setLaidOut(true);

      renderRail(true);

      // `nearest`/`center` and not `smooth`: the row is scrolled sideways under an already-open
      // composer, so this has to be the minimum movement that reveals the chip.
      expect(scrolled).toEqual([{ testId: 'meeting-composer-rail-compact-details-access', options: { block: 'nearest', inline: 'center' } }]);
    });

    it('leaves the scroll position alone when the chip row is in the DOM but not laid out', () => {
      // What `lg:hidden` produces: the query still finds the chip, and `getClientRects()` is empty for
      // anything `display: none`. Scrolling here would move the page behind a row nobody can see.
      setLaidOut(false);

      renderRail(true);

      expect(fixture.nativeElement.querySelector('[data-active-chip]')).not.toBeNull();
      expect(scrolled).toEqual([]);
    });

    it('never scrolls in the vertical layout, however the rail is laid out', () => {
      setLaidOut(true);

      renderRail(false);

      expect(scrolled).toEqual([]);
    });
  });
});
