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
import { beforeEach, describe, expect, it, vi } from 'vitest';

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

  /** Fills what `details-access` validates, which is what unblocks everything after it. */
  const completeDetails = (): void => {
    formService.form().get('title')?.setValue('Composer meeting');
    formService.form().get('meeting_type')?.setValue('Board');
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
    // Rendered rows are covered by the section-state assertions below; the template only branches on
    // them. Dropping it keeps the fixture free of the icon/class markup and of `NgClass`.
    TestBed.overrideComponent(MeetingComposerRailComponent, { set: { template: '', imports: [] } });

    composer = TestBed.inject(MeetingComposerService);
    formService = TestBed.inject(MeetingComposerFormService);
  });

  describe('create mode', () => {
    beforeEach(() => {
      composer.open({ mode: 'create', projectUid: 'project-1' });
      formService.initialize({ mode: 'create', projectUid: 'project-1' });

      fixture = TestBed.createComponent(MeetingComposerRailComponent);
      fixture.detectChanges();
    });

    it('locks everything past the first required section while it is still empty', () => {
      // `date-schedule` is valid from its own defaults, so a ceiling-only rule would already offer it.
      expect(formService.isSectionValid('date-schedule')).toBe(true);
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

      expect(reachableIds()).toEqual(['details-access', 'date-schedule', 'platform-features']);
    });

    it('re-locks the sections past a required one that was emptied again', () => {
      completeDetails();
      composer.setSection('date-schedule');
      composer.setSection('platform-features');
      formService.form().get('title')?.setValue('');

      // Visited sections stay reachable up to the break, so the organizer can walk back to the field
      // that broke — but nothing past it opens, even though `platform-features` was visited.
      expect(reachableIds()).toEqual(['details-access']);
    });

    it('marks a section complete only after it has been visited', () => {
      completeDetails();

      // Valid out of the box, but a check mark on a section nobody has opened claims work that did not
      // happen.
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
});
