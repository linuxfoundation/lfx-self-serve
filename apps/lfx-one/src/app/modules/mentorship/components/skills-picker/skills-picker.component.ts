// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ChangeDetectionStrategy, Component, computed, input, signal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup } from '@angular/forms';
import { AutocompleteComponent } from '@components/autocomplete/autocomplete.component';
import { ButtonComponent } from '@components/button/button.component';
import { MENTORSHIP_SKILL_MAX_LENGTH } from '@lfx-one/shared/constants';
import { mentorshipSkillSuggestions } from '@lfx-one/shared/utils';
import { AutoCompleteCompleteEvent } from 'primeng/autocomplete';
import { startWith, switchMap } from 'rxjs';

/**
 * Skill picker shared by the mentorship forms — a text field that suggests skills from the
 * `MENTORSHIP_SKILL_OPTIONS` catalog but also accepts a custom skill, an Add button, and the
 * chosen skills as removable chips. The enroll wizard asks which skills a program needs; the
 * Become a Mentor form asks which a mentor has; the Become a Mentee form asks for skills-have
 * and skills-want. All three surfaces are required, so the red `*` marker is hard-wired on the label.
 *
 * The chosen skills live in the caller's form under `control`; the draft field is local
 * so a half-made choice never reaches the caller. Renders the field only, without a
 * section wrapper, because the enroll wizard nests it beside other fields.
 */
@Component({
  selector: 'lfx-mentorship-skills-picker',
  imports: [AutocompleteComponent, ButtonComponent],
  templateUrl: './skills-picker.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SkillsPickerComponent {
  public readonly form = input.required<FormGroup>();
  public readonly label = input.required<string>();
  /** Prefixes the skill field, add-button, and chip test ids. */
  public readonly idPrefix = input.required<string>();
  public readonly control = input('skills');
  public readonly helper = input<string | undefined>(undefined);
  public readonly error = input<string | undefined>(undefined);

  protected readonly draftForm = new FormGroup({
    skill: new FormControl<string | null>(''),
  });

  protected readonly suggestions = signal<string[]>([]);
  protected readonly skillMaxLength = MENTORSHIP_SKILL_MAX_LENGTH;

  protected readonly draftValue = toSignal(this.draftForm.controls.skill.valueChanges, { initialValue: '' as string | null });
  protected readonly canAddSkill = computed(() => !!this.draftValue()?.trim());

  protected readonly skills = this.initSkills();

  protected searchSkills(event: AutoCompleteCompleteEvent): void {
    this.suggestions.set(mentorshipSkillSuggestions(event.query ?? '', this.skills()));
  }

  protected addSkill(): void {
    const value = (this.draftForm.controls.skill.value ?? '').trim();
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
}
