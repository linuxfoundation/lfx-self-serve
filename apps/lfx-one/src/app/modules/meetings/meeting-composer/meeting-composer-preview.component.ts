// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { NgClass } from '@angular/common';
import { Component, computed, inject, type Signal } from '@angular/core';
import { MEETING_COMPOSER_PREVIEW_FEATURES, MEETING_PLATFORMS, MEETING_TYPE_OPTIONS, MEETING_VISIBILITY_OPTIONS } from '@lfx-one/shared/constants';
import type { MeetingVisibility } from '@lfx-one/shared/enums';
import type { MeetingComposerPreviewDateChip, MeetingComposerPreviewRow } from '@lfx-one/shared/interfaces';
import { buildRecurrenceSummary, convertRecurrenceToPattern } from '@lfx-one/shared/utils';

import { MeetingComposerFormService } from './meeting-composer-form.service';
import { MeetingComposerService } from './meeting-composer.service';

/**
 * Live preview of the meeting being created (GH-1459).
 * @description Create mode only — in edit mode the meeting already exists and the sections themselves
 * show its saved state. Rows carry no field labels: an icon plus the chosen value, or a bar while the
 * value is still unknown. A row shows the bar rather than presenting one of the composer's own defaults
 * as a choice the organizer made, which for `platform` — the one control that still opens pre-filled —
 * means waiting until its section has been visited. Every other row resolves on its value alone, so a
 * quick-create handoff carries its answers straight into the panel.
 */
@Component({
  selector: 'lfx-meeting-composer-preview',
  imports: [NgClass],
  templateUrl: './meeting-composer-preview.component.html',
})
export class MeetingComposerPreviewComponent {
  private readonly composer = inject(MeetingComposerService);
  private readonly formService = inject(MeetingComposerFormService);

  protected readonly dateChip: Signal<MeetingComposerPreviewDateChip> = this.initDateChip();
  protected readonly title: Signal<string> = this.initTitle();
  protected readonly whenSummary: Signal<string | null> = this.initWhenSummary();
  protected readonly typeRow: Signal<MeetingComposerPreviewRow | null> = this.initTypeRow();
  protected readonly visibility: Signal<MeetingComposerPreviewRow | null> = this.initVisibility();
  protected readonly recurrenceLabel: Signal<string | null> = this.initRecurrenceLabel();
  protected readonly platformLabel: Signal<string | null> = this.initPlatformLabel();
  protected readonly features: Signal<MeetingComposerPreviewRow[]> = this.initFeatures();
  protected readonly guestLabel: Signal<string | null> = this.initGuestLabel();

  private initDateChip(): Signal<MeetingComposerPreviewDateChip> {
    return computed(() => {
      const startDate = this.startDate();

      if (!startDate) {
        return { day: '··', month: '—' };
      }

      return {
        day: startDate.toLocaleDateString('en-US', { day: 'numeric' }),
        month: startDate.toLocaleDateString('en-US', { month: 'short' }).toUpperCase(),
      };
    });
  }

  private initTitle(): Signal<string> {
    return computed(() => {
      const title = (this.controlValue('title') as string | null)?.trim();

      return title || 'Untitled meeting';
    });
  }

  /** Date alone once it is picked, then `date · time` — duration and timezone stay out of this line. */
  private initWhenSummary(): Signal<string | null> {
    return computed(() => {
      const startDate = this.startDate();

      if (!startDate) {
        return null;
      }

      const date = startDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
      const startTime = (this.controlValue('startTime') as string | null) ?? '';

      return [date, startTime].filter(Boolean).join(' · ');
    });
  }

  /**
   * Type row, carrying the selected type's own icon rather than one glyph for every type.
   * @description Sourced from `MEETING_TYPE_OPTIONS`, which is where the section's type select and the
   * meeting card's tag also read their icons, so the preview names the choice with the same glyph the
   * organizer just clicked. No `color`: visibility is the one row the design tints, and giving the type
   * its scale colour as well would turn the panel into a swatch.
   */
  private initTypeRow(): Signal<MeetingComposerPreviewRow | null> {
    return computed(() => {
      const meetingType = this.controlValue('meeting_type');
      const option = MEETING_TYPE_OPTIONS.find((candidate) => candidate.value === meetingType);

      if (!option?.info?.icon) {
        return null;
      }

      return { label: option.label, icon: option.info.icon };
    });
  }

  /** Visibility row, or `null` when the stored value isn't one of the offered options. */
  private initVisibility(): Signal<MeetingComposerPreviewRow | null> {
    return computed(() => {
      const visibility = this.controlValue('visibility') as MeetingVisibility | null;
      const option = MEETING_VISIBILITY_OPTIONS.find((candidate) => candidate.value === visibility);

      if (!option?.info?.icon) {
        return null;
      }

      return { label: option.label, icon: option.info.icon, color: option.info.color };
    });
  }

  /**
   * Recurrence row: the chosen cadence, `Does not repeat` once Date & Schedule has been visited, or
   * `null`.
   * @description Only the "Does not repeat" half is gated on visitation. It is a real answer, but it is
   * also what an untouched form says, so against a section the organizer has never opened it would be
   * stating the default back at them. A cadence they actually picked is not the default and needs no
   * gate — it can arrive from the quick-create dialog, whose recurring card never visits the drawer's
   * schedule section. The gate is visitation rather than section validity because the recurrence
   * controls are answered independently of the date and time, so a schedule that is merely unfinished
   * should not blank a cadence already chosen.
   */
  private initRecurrenceLabel(): Signal<string | null> {
    return computed(() => {
      this.formService.revision();

      if (this.controlValue('isRecurring') !== true) {
        return this.composer.visitedSections().has('date-schedule') ? 'Does not repeat' : null;
      }

      const recurrence = this.formService.recurrencePayload();

      if (!recurrence) {
        return null;
      }

      return buildRecurrenceSummary(convertRecurrenceToPattern(recurrence)).fullSummary;
    });
  }

  /**
   * Platform label, or `null` while the Platform & Features section is still unvisited.
   * @description The control is pre-filled with a default, so showing it before the organizer has seen
   * the section would present a choice they never made.
   */
  private initPlatformLabel(): Signal<string | null> {
    return computed(() => {
      if (!this.composer.visitedSections().has('platform-features')) {
        return null;
      }

      const platform = this.controlValue('platform');

      return MEETING_PLATFORMS.find((option) => option.value === platform)?.label ?? null;
    });
  }

  private initFeatures(): Signal<MeetingComposerPreviewRow[]> {
    return computed(() =>
      MEETING_COMPOSER_PREVIEW_FEATURES.filter((feature) => this.controlValue(feature.control) === true).map((feature) => ({
        label: feature.label,
        icon: feature.icon,
      }))
    );
  }

  /** `null` at zero guests — the design shows a bar there rather than "0 invited". */
  private initGuestLabel(): Signal<string | null> {
    return computed(() => {
      const count = this.formService.guests().filter((guest) => guest.state !== 'deleted').length;

      if (count === 0) {
        return null;
      }

      return `${count} ${count === 1 ? 'guest' : 'guests'} invited`;
    });
  }

  /**
   * Start date, or `null` while it is unanswered or unparseable.
   * @description Ungated. The schedule controls used to open seeded a week out, so a value there did not
   * mean the organizer had picked one and the row waited on the section being visited; they are left
   * empty now, so a value is an answer wherever it came from — including the quick-create dialog, which
   * hands its date over without ever visiting the drawer's schedule section.
   */
  private startDate(): Date | null {
    const value = this.controlValue('startDate');

    return value instanceof Date && !Number.isNaN(value.getTime()) ? value : null;
  }

  /** Reads a control's value through `revision()`, which is what makes form state reactive here. */
  private controlValue(control: string): unknown {
    this.formService.revision();

    return this.formService.form().get(control)?.value ?? null;
  }
}
