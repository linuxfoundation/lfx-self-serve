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
 * value is still unknown. Several controls are pre-filled with defaults, so a row only resolves once
 * its owning section has been visited (or, for recurrence, is complete) — until then it shows the bar
 * rather than presenting a default as a choice the organizer made. Details & Access is where the
 * composer opens, so its rows resolve as soon as they have a value.
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
  protected readonly typeLabel: Signal<string | null> = this.initTypeLabel();
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

  private initTypeLabel(): Signal<string | null> {
    return computed(() => {
      const meetingType = this.controlValue('meeting_type');

      return MEETING_TYPE_OPTIONS.find((option) => option.value === meetingType)?.label ?? null;
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
   * Recurrence row, or `null` while Date & Schedule is still incomplete.
   * @description "Does not repeat" is a real answer, but only once the organizer has actually settled
   * the schedule — showing it against an empty section would be stating the default back at them.
   */
  private initRecurrenceLabel(): Signal<string | null> {
    return computed(() => {
      this.formService.revision();

      if (!this.formService.isSectionValid('date-schedule')) {
        return null;
      }

      if (this.controlValue('isRecurring') !== true) {
        return 'Does not repeat';
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

  /** Start date, or `null` while Date & Schedule is unvisited — the control opens pre-filled with a default. */
  private startDate(): Date | null {
    if (!this.composer.visitedSections().has('date-schedule')) {
      return null;
    }

    const value = this.controlValue('startDate');

    return value instanceof Date && !Number.isNaN(value.getTime()) ? value : null;
  }

  /** Reads a control's value through `revision()`, which is what makes form state reactive here. */
  private controlValue(control: string): unknown {
    this.formService.revision();

    return this.formService.form().get(control)?.value ?? null;
  }
}
