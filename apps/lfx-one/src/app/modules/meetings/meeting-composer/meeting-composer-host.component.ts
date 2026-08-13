// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { NgClass } from '@angular/common';
import { Component, computed, inject, type Signal } from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import { ButtonComponent } from '@components/button/button.component';
import { MEETING_COMPOSER_SECTIONS, MEETING_COMPOSER_TOAST_KEY, MEETING_COMPOSER_TOAST_LIFE } from '@lfx-one/shared/constants';
import type { Meeting, MeetingComposerSection, MeetingComposerToastData } from '@lfx-one/shared/interfaces';
import { ProjectContextService } from '@services/project-context.service';
import { MessageService } from 'primeng/api';
import { DrawerModule } from 'primeng/drawer';
import { ToastModule } from 'primeng/toast';
import { filter, pairwise } from 'rxjs';

import { MeetingComposerFormService } from './meeting-composer-form.service';
import { MeetingComposerPreviewComponent } from './meeting-composer-preview.component';
import { MeetingComposerRailComponent } from './meeting-composer-rail.component';
import { MeetingComposerService } from './meeting-composer.service';
import { QuickCreateDialogComponent } from './quick-create-dialog.component';
import { ComposerAgendaResourcesComponent } from './sections/composer-agenda-resources.component';
import { ComposerDateScheduleComponent } from './sections/composer-date-schedule.component';
import { ComposerDetailsAccessComponent } from './sections/composer-details-access.component';
import { ComposerGuestsComponent } from './sections/composer-guests.component';
import { ComposerPlatformFeaturesComponent } from './sections/composer-platform-features.component';

/**
 * Globally mounted host for the meeting composer drawer (LFXV2-3234).
 * @description Mounted on first open via `@defer` in `app.component.html` and retained thereafter, so
 * opening the composer never unmounts the page underneath. Sections are reachable from both the rail
 * and the footer navigation; the live preview is create-mode only. Below `lg` the drawer goes full
 * width, the rail column and the preview drop out, and the rail's compact chip row takes over section
 * navigation — the preview has no narrow-viewport equivalent.
 */
@Component({
  selector: 'lfx-meeting-composer-host',
  imports: [
    NgClass,
    DrawerModule,
    MeetingComposerRailComponent,
    MeetingComposerPreviewComponent,
    ButtonComponent,
    ComposerDetailsAccessComponent,
    ComposerDateScheduleComponent,
    ComposerPlatformFeaturesComponent,
    ComposerGuestsComponent,
    ComposerAgendaResourcesComponent,
    QuickCreateDialogComponent,
    ToastModule,
    RouterLink,
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
  protected readonly toastKey = MEETING_COMPOSER_TOAST_KEY;

  /**
   * Single mode source for the chrome, matching what the rail reads.
   * @description Taken from the form service rather than the composer service: this host is
   * `@defer`-mounted and `initialize()` runs from a subscription in the constructor, so the composer
   * context can say `edit` for a paint before the form service agrees. Reading both sources would put
   * the edit header and Save button above a create-mode stepper with locked rows.
   */
  protected readonly isEditMode: Signal<boolean> = this.formService.isEditMode;

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
  protected readonly activeSectionLabel: Signal<string> = computed(() => this.sections[this.activeIndex()]?.label ?? '');
  /** Whether any required section is flagged as blocking save, on the same rule as the rail's dots. */
  protected readonly hasAttention: Signal<boolean> = computed(() => {
    this.formService.revision();

    const visited = this.composer.visitedSections();

    return this.sections.some((section) => this.formService.sectionNeedsAttention(section, visited));
  });
  /**
   * Why the toast's Edit action can't act, or `null` when it can.
   * @description Doubles as the enabled check. Reopening while another meeting is part-way through the
   * composer would discard that draft, and reopening after write access was lost would only fail on save.
   */
  protected readonly editFromToastBlockedReason: Signal<string | null> = this.initEditFromToastBlockedReason();

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
    this.formService.submit().subscribe((meeting) => {
      if (wasEditMode) {
        this.messageService.add({ severity: 'success', summary: 'Meeting updated', detail: 'Your changes have been saved.' });
      } else {
        this.announceCreatedMeeting(meeting);
      }

      this.composer.notifySaved();
      this.composer.close();
    });
  }

  /**
   * Reopens the composer on the meeting the toast was raised for.
   * @description Guarded by `editFromToastBlockedReason`, which the template also reflects as
   * `aria-disabled` plus a tooltip naming the reason.
   */
  protected onEditCreatedMeeting(data: MeetingComposerToastData): void {
    if (this.editFromToastBlockedReason()) {
      return;
    }

    this.messageService.clear(this.toastKey);
    this.composer.open({ mode: 'edit', meetingUid: data.meetingUid });
  }

  protected onDismissToast(): void {
    this.messageService.clear(this.toastKey);
  }

  private initEditFromToastBlockedReason(): Signal<string | null> {
    return computed(() => {
      if (this.composer.isOpen()) {
        return 'Close the open composer first';
      }

      return this.projectContextService.canWrite() ? null : 'You no longer have write access';
    });
  }

  /**
   * Raises the post-create toast (LFXV2-3242).
   * @description Creating no longer navigates to the saved meeting, so this toast is the only route back
   * to it. A create that returned no meeting has nothing to link to, and falls back to a plain
   * confirmation rather than a toast whose actions would dead-end.
   */
  private announceCreatedMeeting(meeting: Meeting | null): void {
    if (!meeting?.id) {
      this.messageService.add({ severity: 'success', summary: 'Meeting created', detail: 'Open it from the list to review the details.' });
      return;
    }

    const data: MeetingComposerToastData = {
      meetingUid: meeting.id,
      meetingTitle: meeting.title ?? 'Untitled meeting',
      meetingUrl: `/meetings/${meeting.id}`,
      // The join page rejects a private or restricted meeting without its password and redirects to
      // `/meetings/not-found`, which every BOARD meeting would hit since those are forced private.
      meetingQueryParams: meeting.password ? { password: meeting.password } : {},
    };

    this.messageService.add({
      key: this.toastKey,
      severity: 'success',
      summary: 'Meeting created',
      detail: data.meetingTitle,
      life: MEETING_COMPOSER_TOAST_LIFE,
      data,
    });
  }
}
