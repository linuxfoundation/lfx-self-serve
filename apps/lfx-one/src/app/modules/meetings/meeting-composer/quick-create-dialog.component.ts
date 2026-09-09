// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { NgClass } from '@angular/common';
import { Component, computed, inject, output, signal, type Signal } from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { ButtonComponent } from '@components/button/button.component';
import { DEFAULT_DURATION, MEETING_DURATION_CHIP_OPTIONS, MEETING_TEMPLATES } from '@lfx-one/shared/constants';
import { MeetingType } from '@lfx-one/shared/enums';
import type { CardSelectorOption, CommitteeMember, MeetingTemplate } from '@lfx-one/shared/interfaces';
import { getSelectableMeetingTypeOptions } from '@lfx-one/shared/utils';
import { PersonaService } from '@services/persona.service';
import { DialogModule } from 'primeng/dialog';
import { startWith, switchMap } from 'rxjs';

import { MeetingCommitteeManagerComponent } from '../components/meeting-committee-manager/meeting-committee-manager.component';
import { ComposerAgendaFieldComponent } from './composer-agenda-field.component';
import { MeetingComposerFormService } from './meeting-composer-form.service';
import { MeetingComposerService } from './meeting-composer.service';
import { ComposerDateScheduleComponent } from './sections/composer-date-schedule.component';
import { ComposerDetailsAccessComponent } from './sections/composer-details-access.component';

/**
 * Quick create dialog (GH-1460).
 * @description The condensed create surface: the same form and the same submit path as the drawer, laid
 * out as two columns with no rail and no per-section gating. It composes the drawer's Details & Access
 * and Date & Schedule sections rather than reimplementing their controls, so validators, hint copy and
 * type-driven defaults can't drift between the two surfaces. Platform, features and resources keep
 * their form defaults and are edited later in the drawer.
 */
@Component({
  selector: 'lfx-quick-create-dialog',
  imports: [
    NgClass,
    DialogModule,
    ButtonComponent,
    ComposerAgendaFieldComponent,
    ComposerDetailsAccessComponent,
    ComposerDateScheduleComponent,
    MeetingCommitteeManagerComponent,
  ],
  templateUrl: './quick-create-dialog.component.html',
})
export class QuickCreateDialogComponent {
  private readonly personaService = inject(PersonaService);
  protected readonly composer = inject(MeetingComposerService);
  protected readonly formService = inject(MeetingComposerFormService);

  /** Submit stays with the host, so both surfaces save through one path. */
  public readonly create = output<void>();

  /**
   * Asks to continue in the advanced drawer with everything entered so far.
   * @description Announced rather than performed, for the same reason as {@link create}: switching
   * surfaces takes both the composer service and the form service, and the host is the only place that
   * holds them together.
   */
  public readonly switchToAdvanced = output<void>();

  // What the type's template wrote, tracked per control: most templates estimate a duration off the chip
  // scale, which `applyTypeTemplate` skips, so a single flag would keep the details hint alive on the
  // untouched `duration` control long after the organizer rewrote the title.
  private readonly seededTitle = signal(false);
  private readonly seededDuration = signal(false);
  private readonly seededAgenda = signal(false);

  // Derived rather than snapshotted: a hint has to go quiet the moment the organizer rewrites the field,
  // and that happens without any type change to recompute it on. One hint per control, since each sits
  // next to the field it describes and the two columns are far apart on screen.
  protected readonly prefilledTitle: Signal<boolean> = this.initPrefilledTitle();
  protected readonly prefilledDuration: Signal<boolean> = this.initPrefilledDuration();
  protected readonly prefilledAgenda: Signal<boolean> = this.initPrefilledAgenda();

  // Same persona filter the drawer's type select uses, so the two surfaces can't offer different types.
  // Quick create is create-only, so there is no stored type to retain in the list.
  protected readonly meetingTypeOptions: Signal<CardSelectorOption<MeetingType>[]> = computed(() =>
    getSelectableMeetingTypeOptions(this.personaService.currentPersona())
  );
  protected readonly selectedMeetingType: Signal<MeetingType | null> = computed(() => {
    // FormGroup values are not reactive; `revision` is what makes the chip selection repaint.
    this.formService.revision();
    return (this.formService.form().get('meeting_type')?.value as MeetingType | null) ?? null;
  });

  protected readonly canSubmit: Signal<boolean> = computed(() => {
    // FormGroup validity is not reactive; `revision` is what makes this recompute.
    this.formService.revision();
    return this.formService.form().valid;
  });

  public constructor() {
    // The form instance is replaced on every open, and the type can be seeded by the entry point before
    // this dialog mounts, so the current value is replayed rather than waiting for the next change.
    toObservable(this.formService.form)
      .pipe(
        switchMap((form) => {
          const control = form.get('meeting_type');
          return control ? control.valueChanges.pipe(startWith(control.value as MeetingType | null)) : [];
        }),
        takeUntilDestroyed()
      )
      .subscribe((meetingType: MeetingType | null) => this.applyTypeTemplate(meetingType));
  }

  protected onVisibleChange(visible: boolean): void {
    if (!visible) {
      this.composer.close();
    }
  }

  /**
   * Switches the meeting type from the chip row.
   * @description Writes through the control rather than calling `applyTypeTemplate` directly, so the
   * constructor's subscription stays the single place a type change reseeds the form.
   */
  protected onSelectMeetingType(meetingType: MeetingType): void {
    const control = this.formService.form().get('meeting_type');

    if (!control || control.value === meetingType) {
      return;
    }

    control.setValue(meetingType);
    control.markAsDirty();
  }

  protected onCommitteeMembersChange(members: CommitteeMember[]): void {
    this.formService.syncCommitteeMembers(members);
  }

  protected onCreate(): void {
    this.create.emit();
  }

  protected onSwitchToAdvanced(): void {
    this.switchToAdvanced.emit();
  }

  // Private initializer functions
  private initPrefilledTitle(): Signal<boolean> {
    return computed(() => {
      // `revision` is what makes control state reactive here — `validateForSubmit` bumps it for the marks
      // that emit on neither `valueChanges` nor `statusChanges`.
      this.formService.revision();

      return this.seededTitle() && !!this.formService.form().get('title')?.pristine;
    });
  }

  private initPrefilledDuration(): Signal<boolean> {
    return computed(() => {
      this.formService.revision();

      return this.seededDuration() && !!this.formService.form().get('duration')?.pristine;
    });
  }

  private initPrefilledAgenda(): Signal<boolean> {
    return computed(() => {
      this.formService.revision();

      return this.seededAgenda() && !!this.formService.form().get('description')?.pristine;
    });
  }

  // Other private helper methods
  /**
   * Seeds title, agenda and duration from the meeting type's first template.
   * @description Guarded on `pristine` rather than on emptiness: switching type after editing a field must
   * keep the edit, and an emptiness check would treat a prefill from the previous type as free to
   * overwrite — leaving a Board meeting carrying the Technical template's title. Durations off the chip
   * scale are skipped, since seeding one would drop this surface into the custom-minutes input.
   */
  private applyTypeTemplate(meetingType: MeetingType | null): void {
    // Take the previous type's prefill back out first, so a type whose template omits a field — or has
    // no template at all, which is `Other` — can't leave the last type's title and agenda standing
    // under it with the "Pre-filled for this meeting type" hint gone.
    this.clearSeededValues();

    const template = this.defaultTemplateFor(meetingType);

    if (!template) {
      return;
    }

    const form = this.formService.form();
    const title = form.get('title');
    const description = form.get('description');
    const duration = form.get('duration');
    let seededTitle = false;
    let seededDuration = false;
    let seededAgenda = false;

    if (title?.pristine) {
      title.setValue(template.title);
      seededTitle = true;
    }

    if (duration?.pristine && MEETING_DURATION_CHIP_OPTIONS.some((option) => option.value === template.estimatedDuration)) {
      this.formService.setDuration(template.estimatedDuration);
      seededDuration = true;
    }

    if (description?.pristine) {
      description.setValue(template.content);
      seededAgenda = true;
    }

    this.seededTitle.set(seededTitle);
    this.seededDuration.set(seededDuration);
    this.seededAgenda.set(seededAgenda);
  }

  /**
   * Returns the controls this dialog seeded to their untouched state.
   * @description Guarded on `pristine` exactly as the seeding is: a seeded value the organizer has since
   * edited is theirs, and clearing it would throw the edit away. Nothing else needs guarding, because a
   * control only reaches here if a previous pass through {@link applyTypeTemplate} wrote it.
   */
  private clearSeededValues(): void {
    const form = this.formService.form();
    const title = form.get('title');
    const description = form.get('description');
    const duration = form.get('duration');

    if (this.seededTitle() && title?.pristine) {
      title.setValue('');
    }

    if (this.seededDuration() && duration?.pristine) {
      this.formService.setDuration(DEFAULT_DURATION);
    }

    if (this.seededAgenda() && description?.pristine) {
      description.setValue('');
    }

    this.seededTitle.set(false);
    this.seededDuration.set(false);
    this.seededAgenda.set(false);
  }

  /**
   * The template a freshly picked type prefills from, if any.
   * @description Every type but `Other` seeds from its first template. `Other` is the catch-all — its
   * templates describe particular occasions (a community workshop, and so on) rather than anything the
   * type itself implies, so guessing one puts a stranger's agenda and title in front of the organizer.
   * They stay one click away in the agenda field's Templates popover, where picking one is a choice.
   */
  private defaultTemplateFor(meetingType: MeetingType | null): MeetingTemplate | null {
    if (!meetingType || meetingType === MeetingType.OTHER) {
      return null;
    }

    return MEETING_TEMPLATES.find((group) => group.meetingType === meetingType)?.templates[0] ?? null;
  }
}
