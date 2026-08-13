// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { NgClass } from '@angular/common';
import { Component, computed, inject, type Signal } from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { ButtonComponent } from '@components/button/button.component';
import { MEETING_COMPOSER_SECTIONS } from '@lfx-one/shared/constants';
import type { MeetingComposerSection, MeetingComposerSectionId } from '@lfx-one/shared/interfaces';
import { ProjectContextService } from '@services/project-context.service';
import { MessageService } from 'primeng/api';
import { DrawerModule } from 'primeng/drawer';
import { filter, pairwise } from 'rxjs';

import { MeetingComposerFormService } from './meeting-composer-form.service';
import { MeetingComposerService } from './meeting-composer.service';
import { ComposerAgendaResourcesComponent } from './sections/composer-agenda-resources.component';
import { ComposerDateScheduleComponent } from './sections/composer-date-schedule.component';
import { ComposerDetailsAccessComponent } from './sections/composer-details-access.component';
import { ComposerGuestsComponent } from './sections/composer-guests.component';
import { ComposerPlatformFeaturesComponent } from './sections/composer-platform-features.component';

/**
 * Globally mounted host for the meeting composer drawer (LFXV2-3234).
 * @description Mounted on first open via `@defer` in `app.component.html` and retained thereafter, so
 * opening the composer never unmounts the page underneath. The section rail and live preview land in
 * LFXV2-3240; until then the sections are driven by the footer navigation.
 */
@Component({
  selector: 'lfx-meeting-composer-host',
  imports: [
    NgClass,
    DrawerModule,
    ButtonComponent,
    ComposerDetailsAccessComponent,
    ComposerDateScheduleComponent,
    ComposerPlatformFeaturesComponent,
    ComposerGuestsComponent,
    ComposerAgendaResourcesComponent,
  ],
  templateUrl: './meeting-composer-host.component.html',
  providers: [MeetingComposerFormService],
})
export class MeetingComposerHostComponent {
  private readonly messageService = inject(MessageService);
  private readonly projectContextService = inject(ProjectContextService);

  protected readonly composer = inject(MeetingComposerService);
  protected readonly formService = inject(MeetingComposerFormService);

  protected readonly sections: readonly MeetingComposerSection[] = MEETING_COMPOSER_SECTIONS;

  protected readonly activeIndex: Signal<number> = computed(() => this.sections.findIndex((section) => section.id === this.composer.activeSection()));
  protected readonly isLastSection: Signal<boolean> = computed(() => this.activeIndex() === this.sections.length - 1);
  protected readonly canProceed: Signal<boolean> = computed(() => {
    // `revision` makes this recompute on every form value/status change — FormGroup validity is not a signal.
    this.formService.revision();
    return this.formService.isSectionValid(this.composer.activeSection());
  });
  protected readonly canSubmit: Signal<boolean> = computed(() => {
    this.formService.revision();
    return this.sections.filter((section) => section.required).every((section) => this.formService.isSectionValid(section.id));
  });

  public constructor() {
    toObservable(this.composer.context)
      .pipe(
        filter((context) => !!context),
        takeUntilDestroyed()
      )
      .subscribe((context) => this.formService.initialize(context));

    // Losing write access while the composer is open would make submit fail upstream; close it instead
    // of evicting the user from the page underneath. Only a true -> false transition counts: `canWrite`
    // starts false and reports false while the project grants request is unresolved, so reacting to any
    // false would close a composer opened from a deep link before write access ever resolved.
    toObservable(this.projectContextService.canWrite)
      .pipe(
        pairwise(),
        filter(([hadWriteAccess, canWrite]) => hadWriteAccess && !canWrite && this.composer.isOpen()),
        takeUntilDestroyed()
      )
      .subscribe(() => this.composer.close());
  }

  protected onVisibleChange(visible: boolean): void {
    if (!visible) {
      this.composer.close();
    }
  }

  protected onSectionChange(section: MeetingComposerSectionId): void {
    this.composer.setSection(section);
  }

  protected onNext(): void {
    const next = this.sections[this.activeIndex() + 1];
    if (next) {
      this.composer.setSection(next.id);
    }
  }

  protected onBack(): void {
    const previous = this.sections[this.activeIndex() - 1];
    if (previous) {
      this.composer.setSection(previous.id);
    }
  }

  /** Jumps to the section that owns the title field. */
  protected onGoToTitleSection(): void {
    this.composer.setSection('details-access');
  }

  protected onSubmit(): void {
    if (this.formService.submitting() || !this.formService.validateForSubmit()) {
      return;
    }

    const wasEditMode = this.formService.isEditMode();

    // `submit()` completes without emitting when the save outlived its open, so reaching here always
    // means the current open is the one that was saved.
    this.formService.submit().subscribe(() => {
      this.messageService.add({
        severity: 'success',
        summary: 'Success',
        detail: wasEditMode ? 'Meeting updated successfully' : 'Meeting created successfully',
      });

      this.composer.close();
    });
  }
}
