// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { ButtonComponent } from '@components/button/button.component';
import { SelectComponent } from '@components/select/select.component';
import { MENTORSHIP_SKILL_OPTIONS } from '@lfx-one/shared/constants';
import { startWith, switchMap } from 'rxjs';

/**
 * Skill picker shared by the mentorship forms — a filterable select over the canonical
 * catalog, an Add button, and the chosen skills as removable chips. The enroll wizard
 * asks which skills a program needs; the Become a Mentor form asks which a mentor has.
 *
 * The chosen skills live in the caller's form under `control`; the draft select is local
 * so a half-made choice never reaches the caller. Renders the field only, without a
 * section wrapper, because the enroll wizard nests it beside other fields.
 */
@Component({
  selector: 'lfx-mentorship-skills-picker',
  imports: [ReactiveFormsModule, ButtonComponent, SelectComponent],
  templateUrl: './skills-picker.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SkillsPickerComponent {
  public readonly form = input.required<FormGroup>();
  public readonly label = input.required<string>();
  /** Prefixes the select, add-button, and chip test ids. */
  public readonly idPrefix = input.required<string>();
  public readonly control = input('skills');
  public readonly helper = input<string | undefined>(undefined);
  public readonly error = input<string | undefined>(undefined);

  protected readonly draftForm = new FormGroup({
    skill: new FormControl('', { nonNullable: true }),
  });

  protected readonly draftValue = toSignal(this.draftForm.controls.skill.valueChanges, { initialValue: '' });

  protected readonly skills = this.initSkills();
  protected readonly availableSkills = this.initAvailableSkills();

  protected addSkill(): void {
    const value = this.draftForm.controls.skill.value.trim();
    if (!value) return;
    const current = this.skills();
    if (current.some((item) => item.toLowerCase() === value.toLowerCase())) return;
    this.form().controls[this.control()].setValue([...current, value]);
    this.draftForm.controls.skill.setValue('');
  }

  protected removeSkill(skill: string): void {
    this.form().controls[this.control()].setValue(this.skills().filter((item) => item !== skill));
  }

  private initSkills() {
    // Reads through a snapshot of the caller's form so chips repaint when the parent
    // writes skills itself — prefilling from a program, or resetting the form.
    const snapshot = toSignal(toObservable(this.form).pipe(switchMap((group) => group.valueChanges.pipe(startWith(group.getRawValue())))), {
      initialValue: {} as Record<string, unknown>,
    });

    return computed(() => {
      const fromSnapshot = snapshot()[this.control()];
      if (Array.isArray(fromSnapshot)) return fromSnapshot as string[];
      return (this.form().controls[this.control()]?.value as string[]) ?? [];
    });
  }

  private initAvailableSkills() {
    return computed(() => {
      const selected = new Set(this.skills().map((item) => item.toLowerCase()));
      return MENTORSHIP_SKILL_OPTIONS.filter((skill) => !selected.has(skill.toLowerCase())).map((skill) => ({ label: skill, value: skill }));
    });
  }
}
