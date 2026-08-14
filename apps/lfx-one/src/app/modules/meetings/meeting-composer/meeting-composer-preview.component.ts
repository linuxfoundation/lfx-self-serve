// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { NgClass } from '@angular/common';
import { Component, computed, inject, type Signal } from '@angular/core';
import type { FormArray } from '@angular/forms';
import { MEETING_COMPOSER_PREVIEW_FEATURES, MEETING_PLATFORMS, MEETING_TYPE_OPTIONS, MEETING_VISIBILITY_OPTIONS } from '@lfx-one/shared/constants';
import type { MeetingVisibility } from '@lfx-one/shared/enums';
import type { ImportantLinkFormValue, MeetingComposerPreviewDateChip, MeetingComposerPreviewRow } from '@lfx-one/shared/interfaces';
import { buildRecurrenceSummary, convertRecurrenceToPattern } from '@lfx-one/shared/utils';
import { SkeletonModule } from 'primeng/skeleton';

import { MeetingComposerFormService } from './meeting-composer-form.service';
import { MeetingComposerService } from './meeting-composer.service';

/**
 * Live preview of the meeting being created (GH-1459).
 * @description Create mode only — in edit mode the meeting already exists and the sections themselves
 * show its saved state. Several controls are pre-filled with defaults, so a row only resolves once its
 * owning section has been visited; until then it renders as a skeleton bar rather than presenting a
 * default as a choice the organizer made. Details & Access is where the composer opens, so its rows
 * resolve as soon as they have a value.
 */
@Component({
  selector: 'lfx-meeting-composer-preview',
  imports: [NgClass, SkeletonModule],
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
  protected readonly restricted: Signal<boolean> = this.initRestricted();
  protected readonly recurrenceSummary: Signal<string | null> = this.initRecurrenceSummary();
  protected readonly platformLabel: Signal<string | null> = this.initPlatformLabel();
  protected readonly features: Signal<MeetingComposerPreviewRow[]> = this.initFeatures();
  protected readonly guestCount: Signal<number> = this.initGuestCount();
  protected readonly resourceCount: Signal<number> = this.initResourceCount();

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

  private initWhenSummary(): Signal<string | null> {
    return computed(() => {
      const startDate = this.startDate();
      const startTime = startDate ? ((this.controlValue('startTime') as string | null) ?? '') : '';
      const date = startDate ? startDate.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }) : '';

      return [date, startTime].filter(Boolean).join(' · ') || null;
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

      return { label: option.label, icon: option.info.icon };
    });
  }

  private initRestricted(): Signal<boolean> {
    return computed(() => this.controlValue('restricted') === true);
  }

  private initRecurrenceSummary(): Signal<string | null> {
    return computed(() => {
      if (this.controlValue('isRecurring') !== true) {
        return null;
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

  private initGuestCount(): Signal<number> {
    return computed(() => this.formService.guests().filter((guest) => guest.state !== 'deleted').length);
  }

  /** Documents and links staged for upload. Saved attachments are ignored — nothing is saved yet in create mode. */
  private initResourceCount(): Signal<number> {
    return computed(() => {
      this.formService.revision();

      const pendingAttachments = (this.formService.form().get('attachments')?.value as unknown[] | null) ?? [];
      const links = ((this.formService.form().get('important_links') as FormArray | null)?.value ?? []) as ImportantLinkFormValue[];

      return pendingAttachments.length + links.filter((link) => !!link.url?.trim()).length;
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
