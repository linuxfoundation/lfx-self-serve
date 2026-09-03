// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ChangeDetectionStrategy, Component, computed, effect, input, output } from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { ButtonComponent } from '@components/button/button.component';
import { CalendarComponent } from '@components/calendar/calendar.component';
import { CheckboxComponent } from '@components/checkbox/checkbox.component';
import { InputTextComponent } from '@components/input-text/input-text.component';
import { TextareaComponent } from '@components/textarea/textarea.component';
import { MENTORSHIP_CUSTOM_PREREQ_DESCRIPTION_MAX, MENTORSHIP_CUSTOM_PREREQ_FILE_LABEL, MENTORSHIP_CUSTOM_PREREQ_NAME_MAX } from '@lfx-one/shared/constants';
import { MentorshipPrerequisite } from '@lfx-one/shared/interfaces';
import { parseMentorshipDateOnly, toMentorshipDateOnly } from '@lfx-one/shared/utils';

@Component({
  selector: 'lfx-mentorship-enroll-custom-prerequisite',
  imports: [ReactiveFormsModule, ButtonComponent, CalendarComponent, CheckboxComponent, InputTextComponent, TextareaComponent],
  templateUrl: './enroll-custom-prerequisite.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class EnrollCustomPrerequisiteComponent {
  public readonly item = input.required<MentorshipPrerequisite>();
  public readonly index = input.required<number>();
  public readonly showErrors = input(false);
  public readonly itemChange = output<MentorshipPrerequisite>();
  public readonly deleted = output<void>();

  protected readonly nameMax = MENTORSHIP_CUSTOM_PREREQ_NAME_MAX;
  protected readonly descriptionMax = MENTORSHIP_CUSTOM_PREREQ_DESCRIPTION_MAX;
  protected readonly fileLabel = MENTORSHIP_CUSTOM_PREREQ_FILE_LABEL;

  protected readonly form = new FormGroup({
    name: new FormControl('', { nonNullable: true }),
    dueDate: new FormControl<Date | null>(null),
    description: new FormControl('', { nonNullable: true }),
    requireFile: new FormControl(false, { nonNullable: true }),
  });

  private readonly formSnapshot = toSignal(this.form.valueChanges, { initialValue: this.form.getRawValue() });

  protected readonly nameLength = computed(() => String(this.formSnapshot().name ?? '').length);
  protected readonly descriptionLength = computed(() => String(this.formSnapshot().description ?? '').length);
  protected readonly title = computed(() => `Custom Prerequisite ${this.index()}`);

  public constructor() {
    effect(() => {
      const item = this.item();
      this.form.patchValue(
        {
          name: item.name,
          dueDate: item.dueDate ? parseMentorshipDateOnly(item.dueDate) : null,
          description: item.description,
          requireFile: item.requireFile === true,
        },
        { emitEvent: false }
      );
    });

    this.form.valueChanges.pipe(takeUntilDestroyed()).subscribe(() => this.emitChange());
  }

  protected onDelete(): void {
    this.deleted.emit();
  }

  private emitChange(): void {
    const value = this.form.getRawValue();
    const name = value.name.slice(0, MENTORSHIP_CUSTOM_PREREQ_NAME_MAX);
    const description = value.description.slice(0, MENTORSHIP_CUSTOM_PREREQ_DESCRIPTION_MAX);
    if (name !== value.name) {
      this.form.controls.name.setValue(name, { emitEvent: false });
    }
    if (description !== value.description) {
      this.form.controls.description.setValue(description, { emitEvent: false });
    }

    this.itemChange.emit({
      ...this.item(),
      name,
      description,
      dueDate: value.dueDate ? toMentorshipDateOnly(value.dueDate) : '',
      requireFile: value.requireFile,
      custom: true,
      required: true,
    });
  }
}
