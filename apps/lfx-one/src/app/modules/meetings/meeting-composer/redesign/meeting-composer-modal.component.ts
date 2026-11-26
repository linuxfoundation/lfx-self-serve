// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { A11yModule } from '@angular/cdk/a11y';
import { Overlay } from '@angular/cdk/overlay';
import { afterNextRender, afterRenderEffect, Component, computed, DestroyRef, ElementRef, inject, input, output, type Signal, viewChild } from '@angular/core';
import { MEETING_COMPOSER_OCCURRENCE_NOTES, MEETING_COMPOSER_SECTION_DESCRIPTIONS } from '@lfx-one/shared/constants';
import type { MeetingComposerProjectLabel, MeetingComposerScopeNote, MeetingComposerSection, MeetingComposerSectionId } from '@lfx-one/shared/interfaces';
import { formatMeetingOccurrenceLabel } from '@lfx-one/shared/utils';
import { ProjectContextService } from '@services/project-context.service';
import { UiButtonComponent } from '@shared/uikit/button/button.component';
import { UiOptionComponent } from '@shared/uikit/select/option.component';
import { UiSelectComponent } from '@shared/uikit/select/select.component';
import { PrimeNG } from 'primeng/config';
import { ZIndexUtils } from 'primeng/utils';

import { MeetingComposerFormService } from '../meeting-composer-form.service';
import { MeetingComposerPreviewComponent } from '../meeting-composer-preview.component';
import { MeetingComposerService } from '../meeting-composer.service';
import { ComposerAgendaResourcesComponent } from '../sections/composer-agenda-resources.component';
import { ComposerDateScheduleComponent } from '../sections/composer-date-schedule.component';
import { ComposerDetailsAccessComponent } from '../sections/composer-details-access.component';
import { ComposerGuestsComponent } from '../sections/composer-guests.component';
import { ComposerPlatformFeaturesComponent } from '../sections/composer-platform-features.component';
import { MeetingComposerModalRailComponent } from './meeting-composer-modal-rail.component';
import { MeetingComposerScopeNoteComponent } from './meeting-composer-scope-note.component';

/**
 * Near-fullscreen composer modal behind `meetings-redesign`: rail, section column, footer and preview.
 * @description Mounted by the host only while the composer is open. The host keeps the gating and the
 * save; this shell lays them out and reports the organizer's intent through its outputs.
 */
@Component({
  selector: 'lfx-meeting-composer-modal',
  imports: [
    A11yModule,
    UiButtonComponent,
    UiSelectComponent,
    UiOptionComponent,
    MeetingComposerModalRailComponent,
    MeetingComposerScopeNoteComponent,
    MeetingComposerPreviewComponent,
    ComposerDetailsAccessComponent,
    ComposerDateScheduleComponent,
    ComposerPlatformFeaturesComponent,
    ComposerGuestsComponent,
    ComposerAgendaResourcesComponent,
  ],
  templateUrl: './meeting-composer-modal.component.html',
})
export class MeetingComposerModalComponent {
  private readonly projectContextService = inject(ProjectContextService);
  private readonly primeng = inject(PrimeNG);
  private readonly overlay = inject(Overlay);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly composer = inject(MeetingComposerService);
  protected readonly formService = inject(MeetingComposerFormService);

  public readonly canProceed = input.required<boolean>();
  public readonly canSubmit = input.required<boolean>();

  public readonly closed = output<void>();
  public readonly next = output<void>();
  public readonly back = output<void>();
  public readonly submitted = output<void>();
  public readonly editSeries = output<MeetingComposerSectionId>();
  public readonly goToTitleSection = output<void>();

  protected readonly root = viewChild.required<ElementRef<HTMLElement>>('root');
  protected readonly scroll = viewChild<ElementRef<HTMLElement>>('scroll');

  protected readonly sections: Signal<readonly MeetingComposerSection[]> = this.formService.visibleSections;
  protected readonly isEditMode: Signal<boolean> = this.formService.isEditMode;
  protected readonly isOccurrenceEdit: Signal<boolean> = this.formService.isOccurrenceEdit;
  protected readonly heading: Signal<string> = computed(() => (this.isEditMode() ? 'Edit meeting' : 'Create meeting'));
  protected readonly activeIndex: Signal<number> = computed(() => this.sections().findIndex((section) => section.id === this.composer.activeSection()));
  protected readonly activeSection: Signal<MeetingComposerSection | null> = computed(() => this.sections()[this.activeIndex()] ?? null);
  protected readonly isLastSection: Signal<boolean> = computed(() => this.activeIndex() === this.sections().length - 1);
  protected readonly sectionDescription: Signal<string> = computed(() => MEETING_COMPOSER_SECTION_DESCRIPTIONS[this.composer.activeSection()]);
  protected readonly occurrenceNote: Signal<string | null> = computed(() =>
    this.isOccurrenceEdit() ? (MEETING_COMPOSER_OCCURRENCE_NOTES[this.composer.activeSection()] ?? null) : null
  );
  protected readonly project: Signal<MeetingComposerProjectLabel | null> = this.initProject();
  protected readonly scope: Signal<MeetingComposerScopeNote | null> = this.initScope();

  public constructor() {
    // Registered on PrimeNG's modal layer so the body-appended overlays of the sections stack above it.
    afterNextRender(() => {
      const root = this.root().nativeElement;
      const scrollBlock = this.overlay.scrollStrategies.block();

      ZIndexUtils.set('modal', root, this.primeng.zIndex.modal);
      scrollBlock.enable();
      this.destroyRef.onDestroy(() => {
        ZIndexUtils.clear(root);
        scrollBlock.disable();
      });
    });

    // Each section starts at its top.
    afterRenderEffect(() => {
      this.composer.activeSection();
      const scroll = this.scroll()?.nativeElement;
      if (scroll) {
        scroll.scrollTop = 0;
      }
    });
  }

  protected onClose(): void {
    if (!this.formService.submitting()) {
      this.closed.emit();
    }
  }

  protected onEscape(event: Event): void {
    if (event.defaultPrevented) {
      return;
    }

    event.preventDefault();
    this.onClose();
  }

  protected onPickSection(id: string | null): void {
    const section = this.sections().find((candidate) => candidate.id === id);

    if (section) {
      this.composer.setSection(section.id);
    }
  }

  protected onEditSeries(): void {
    this.editSeries.emit(this.composer.activeSection());
  }

  private initProject(): Signal<MeetingComposerProjectLabel | null> {
    return computed(() => {
      const meeting = this.formService.meeting();
      const active = this.projectContextService.activeContext();
      // The ambient project only describes the meeting when it is the one Save writes to.
      const context = active && active.uid === this.formService.effectiveProjectUid() ? active : null;
      const name = meeting?.project_name || context?.name || '';

      return name ? { name, logoUrl: meeting?.project_logo_url || context?.logoUrl || '' } : null;
    });
  }

  private initScope(): Signal<MeetingComposerScopeNote | null> {
    return computed(() => {
      const meeting = this.formService.meeting();

      if (!this.isEditMode() || !meeting) {
        return null;
      }

      const title = meeting.title ?? '';
      const occurrence = this.formService.occurrence();

      if (this.isOccurrenceEdit() && occurrence) {
        return { kind: 'occurrence', title, label: formatMeetingOccurrenceLabel(occurrence, meeting.timezone) };
      }

      if (meeting.recurrence) {
        return { kind: 'series', title };
      }

      const start = { occurrence_id: meeting.id, start_time: meeting.start_time, duration: meeting.duration };
      return { kind: 'single', title, label: formatMeetingOccurrenceLabel(start, meeting.timezone) };
    });
  }
}
