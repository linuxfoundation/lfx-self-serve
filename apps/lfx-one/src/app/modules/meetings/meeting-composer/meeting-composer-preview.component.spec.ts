// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MEETING_COMPOSER_PREVIEW_FEATURES, MEETING_PLATFORMS, MEETING_TYPE_OPTIONS, MEETING_VISIBILITY_OPTIONS } from '@lfx-one/shared/constants';
import { MeetingVisibility } from '@lfx-one/shared/enums';
import type {
  MeetingComposerPreviewDateChip,
  MeetingComposerPreviewRow,
  MeetingComposerSectionId,
  MeetingRegistrantWithState,
  RegistrantState,
} from '@lfx-one/shared/interfaces';
import { CommitteeService } from '@services/committee.service';
import { MeetingService } from '@services/meeting.service';
import { PersonaService } from '@services/persona.service';
import { ProjectContextService } from '@services/project-context.service';
import { MessageService } from 'primeng/api';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { MeetingComposerFormService } from './meeting-composer-form.service';
import { MeetingComposerPreviewComponent } from './meeting-composer-preview.component';
import { MeetingComposerService } from './meeting-composer.service';

/**
 * Covers the preview's "has the organizer actually answered this?" gating.
 *
 * Every row here is a claim about a decision the organizer made, so the interesting cases are the ones
 * where a control holds a value nobody chose: `startDate`, `platform`, `visibility` and the recurrence
 * cadence all open pre-filled or default, and echoing those straight back would present the composer's
 * own defaults as the organizer's answers. Each gated row is therefore asserted twice — once before its
 * section has been visited and once after — because an ungated implementation still passes the second
 * half on its own. The un-gated rows (title, type, features, guests) are pinned in the same way, since
 * the asymmetry between the two groups is deliberate and not obvious from either one alone.
 */
describe('MeetingComposerPreviewComponent', () => {
  let fixture: ComponentFixture<MeetingComposerPreviewComponent>;
  let composer: MeetingComposerService;
  let formService: MeetingComposerFormService;

  const BOARD = MEETING_TYPE_OPTIONS[0];
  const PUBLIC_VISIBILITY = MEETING_VISIBILITY_OPTIONS.find((option) => option.value === MeetingVisibility.PUBLIC)!;
  const ZOOM = MEETING_PLATFORMS[0];

  /** A Thursday, so the weekly cadence below has a weekday to name. */
  const START_DATE = new Date(2026, 2, 5);

  const dateChip = (): MeetingComposerPreviewDateChip => fixture.componentInstance['dateChip']();
  const title = (): string => fixture.componentInstance['title']();
  const whenSummary = (): string | null => fixture.componentInstance['whenSummary']();
  const typeRow = (): MeetingComposerPreviewRow | null => fixture.componentInstance['typeRow']();
  const visibility = (): MeetingComposerPreviewRow | null => fixture.componentInstance['visibility']();
  const recurrenceLabel = (): string | null => fixture.componentInstance['recurrenceLabel']();
  const platformLabel = (): string | null => fixture.componentInstance['platformLabel']();
  const features = (): MeetingComposerPreviewRow[] => fixture.componentInstance['features']();
  const guestLabel = (): string | null => fixture.componentInstance['guestLabel']();

  const set = (control: string, value: unknown): void => {
    formService.form().get(control)?.setValue(value);
  };

  /** Puts the organizer on a section and back, which is all `visitedSections` records. */
  const visit = (section: MeetingComposerSectionId): void => {
    composer.setSection(section);
    composer.setSection('details-access');
  };

  /** Only `state` is read here — the preview counts guest rows, it never renders their fields. */
  const guest = (state: RegistrantState): MeetingRegistrantWithState => ({ state }) as MeetingRegistrantWithState;

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

    TestBed.overrideComponent(MeetingComposerPreviewComponent, { set: { template: '', imports: [] } });

    composer = TestBed.inject(MeetingComposerService);
    formService = TestBed.inject(MeetingComposerFormService);
    composer.open({ mode: 'create', projectUid: 'project-1' });
    formService.initialize({ mode: 'create', projectUid: 'project-1' });

    fixture = TestBed.createComponent(MeetingComposerPreviewComponent);
    fixture.detectChanges();
  });

  describe('date chip and when line', () => {
    it('holds the placeholder marks while Date & Schedule is unvisited, whatever the control holds', () => {
      set('startDate', START_DATE);
      set('startTime', '10:00 AM');

      expect(dateChip()).toEqual({ day: '··', month: '—' });
      expect(whenSummary()).toBeNull();
    });

    it('renders the picked date once the organizer has seen the section', () => {
      visit('date-schedule');
      set('startDate', START_DATE);

      expect(dateChip()).toEqual({ day: '5', month: 'MAR' });
    });

    it('shows the date alone while the time is still empty', () => {
      visit('date-schedule');
      set('startDate', START_DATE);

      expect(whenSummary()).toBe('Mar 5, 2026');
    });

    it('joins the date and time once both are answered', () => {
      visit('date-schedule');
      set('startDate', START_DATE);
      set('startTime', '10:00 AM');

      expect(whenSummary()).toBe('Mar 5, 2026 · 10:00 AM');
    });

    it('treats an unparseable date as unset rather than rendering "Invalid Date"', () => {
      visit('date-schedule');
      set('startDate', new Date('not a date'));

      expect(dateChip()).toEqual({ day: '··', month: '—' });
      expect(whenSummary()).toBeNull();
    });
  });

  describe('title', () => {
    it('names the meeting once a title is typed, without its surrounding whitespace', () => {
      set('title', '  Quarterly board sync  ');

      expect(title()).toBe('Quarterly board sync');
    });

    it('falls back to a placeholder for a title that is only whitespace', () => {
      set('title', '   ');

      expect(title()).toBe('Untitled meeting');
    });
  });

  describe('type row', () => {
    it('stays unset until a meeting type is chosen, since nothing is pre-selected', () => {
      expect(typeRow()).toBeNull();
    });

    it("carries the chosen type's own icon", () => {
      set('meeting_type', BOARD.value);

      expect(typeRow()).toEqual({ label: BOARD.label, icon: BOARD.info!.icon });
    });

    it('leaves the type row uncoloured, so visibility stays the only tinted row', () => {
      set('meeting_type', BOARD.value);

      expect(typeRow()).not.toHaveProperty('color');
    });
  });

  describe('visibility row', () => {
    // Details & Access is where the composer opens, so this row resolves as soon as it has a value —
    // it is deliberately not gated on a visit the way the rows below are.
    it("renders the visibility card's own icon and colour without waiting for a visit", () => {
      set('visibility', MeetingVisibility.PUBLIC);

      expect(visibility()).toEqual({
        label: PUBLIC_VISIBILITY.label,
        icon: PUBLIC_VISIBILITY.info!.icon,
        color: PUBLIC_VISIBILITY.info!.color,
      });
    });

    it('drops the row entirely when the stored value is not one of the offered options', () => {
      set('visibility', 'archived');

      expect(visibility()).toBeNull();
    });
  });

  describe('recurrence row', () => {
    it('stays unset while Date & Schedule is unvisited, even for a meeting already marked recurring', () => {
      set('isRecurring', true);
      set('recurrenceType', 'daily');
      set('startDate', START_DATE);

      expect(recurrenceLabel()).toBeNull();
    });

    it('reads "Does not repeat" once the organizer has actually seen the section', () => {
      visit('date-schedule');

      expect(recurrenceLabel()).toBe('Does not repeat');
    });

    it('summarises the chosen cadence', () => {
      visit('date-schedule');
      set('startDate', START_DATE);
      set('isRecurring', true);
      set('recurrenceType', 'daily');

      expect(recurrenceLabel()).toBe('Daily');
    });

    it('derives the weekday from the start date rather than naming a fixed one', () => {
      visit('date-schedule');
      set('startDate', START_DATE);
      set('isRecurring', true);
      set('recurrenceType', 'weekly');

      expect(recurrenceLabel()).toBe('Weekly on Thursday');
    });

    it('stays unset for a cadence that cannot be resolved yet, rather than taking the composer down', () => {
      // The cadence needs the start date to name a weekday, and the preview recomputes on every
      // keystroke — so "recurring, no date yet" is a state the organizer passes through, not an error.
      visit('date-schedule');
      set('isRecurring', true);
      set('recurrenceType', 'weekly');

      expect(recurrenceLabel()).toBeNull();
    });
  });

  describe('platform row', () => {
    it('stays unset until Platform & Features has been visited, since the control opens pre-filled', () => {
      expect(formService.form().get('platform')?.value).toBe(ZOOM.value);
      expect(platformLabel()).toBeNull();
    });

    it('names the platform once the organizer has seen the section', () => {
      visit('platform-features');

      expect(platformLabel()).toBe(ZOOM.label);
    });

    it('stays unset for a platform outside the offered list', () => {
      visit('platform-features');
      set('platform', 'Carrier pigeon');

      expect(platformLabel()).toBeNull();
    });
  });

  describe('feature rows', () => {
    it('lists nothing while every feature is off', () => {
      expect(features()).toEqual([]);
    });

    // Unlike the platform row above, features are not gated on a visit: every one of them is off by
    // default, so a row here can only exist because the organizer switched it on.
    it('lists an enabled feature without waiting for the section to be visited', () => {
      set('recording_enabled', true);

      expect(features().map((feature) => feature.label)).toEqual(['Recording']);
    });

    it("orders the rows by the panel's own order, not by the order they were switched on", () => {
      set('zoom_ai_enabled', true);
      set('recording_enabled', true);

      expect(features().map((feature) => feature.label)).toEqual(['Recording', 'AI meeting summary']);
    });

    it("takes each row's icon from the feature catalogue rather than restating it", () => {
      set('recording_enabled', true);

      const recording = MEETING_COMPOSER_PREVIEW_FEATURES.find((feature) => feature.control === 'recording_enabled')!;
      expect(features()).toEqual([{ label: recording.label, icon: recording.icon }]);
    });
  });

  describe('guest row', () => {
    it('stays unset at zero guests, so the design shows a bar rather than "0 invited"', () => {
      expect(guestLabel()).toBeNull();
    });

    it('uses the singular for a single guest', () => {
      formService.guests.set([guest('new')]);

      expect(guestLabel()).toBe('1 guest invited');
    });

    it('counts only the guests still on the list', () => {
      formService.guests.set([guest('existing'), guest('deleted'), guest('modified')]);

      expect(guestLabel()).toBe('2 guests invited');
    });
  });
});
