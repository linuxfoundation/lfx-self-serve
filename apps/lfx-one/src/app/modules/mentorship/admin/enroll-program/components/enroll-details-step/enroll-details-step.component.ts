// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ChangeDetectionStrategy, Component, computed, ElementRef, input, signal, viewChild } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { ButtonComponent } from '@components/button/button.component';
import { InputTextComponent } from '@components/input-text/input-text.component';
import { RichEditorComponent } from '@components/rich-editor/rich-editor.component';
import { SelectComponent } from '@components/select/select.component';
import {
  formFromImportedMentorshipProgram,
  MENTORSHIP_CII_APPLY_URL,
  MENTORSHIP_CODE_OF_CONDUCT_TEMPLATE_URL,
  MENTORSHIP_ENROLL_DETAILS_INTRO,
  MENTORSHIP_ENROLL_DESCRIPTION_MAX,
  MENTORSHIP_ENROLL_LOGO_ACCEPT,
  MENTORSHIP_ENROLL_LOGO_HELPER,
  MENTORSHIP_ENROLL_LOGO_MAX_BYTES,
  MENTORSHIP_ENROLL_NAME_MAX,
  MENTORSHIP_PROJECT_OPTIONS,
  MENTORSHIP_SKILL_OPTIONS,
  MOCK_MENTORSHIP_PROGRAMS,
} from '@lfx-one/shared/constants';
import { MentorshipEnrollFieldErrors } from '@lfx-one/shared/interfaces';
import { mentorshipDescriptionLength } from '@lfx-one/shared/utils';
import { startWith, switchMap } from 'rxjs';

@Component({
  selector: 'lfx-mentorship-enroll-details-step',
  imports: [ReactiveFormsModule, InputTextComponent, SelectComponent, RichEditorComponent, ButtonComponent],
  templateUrl: './enroll-details-step.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class EnrollDetailsStepComponent {
  public readonly form = input.required<FormGroup>();
  public readonly errors = input<MentorshipEnrollFieldErrors>({});

  protected readonly fileInput = viewChild<ElementRef<HTMLInputElement>>('fileInput');
  protected readonly logoError = signal('');
  protected readonly draftTechForm = new FormGroup({
    technology: new FormControl('', { nonNullable: true }),
  });

  protected readonly intro = MENTORSHIP_ENROLL_DETAILS_INTRO;
  protected readonly nameMax = MENTORSHIP_ENROLL_NAME_MAX;
  protected readonly descriptionMax = MENTORSHIP_ENROLL_DESCRIPTION_MAX;
  protected readonly logoAccept = MENTORSHIP_ENROLL_LOGO_ACCEPT;
  protected readonly logoHelper = MENTORSHIP_ENROLL_LOGO_HELPER;
  protected readonly ciiApplyUrl = MENTORSHIP_CII_APPLY_URL;
  protected readonly codeOfConductTemplateUrl = MENTORSHIP_CODE_OF_CONDUCT_TEMPLATE_URL;
  protected readonly projectOptions = MENTORSHIP_PROJECT_OPTIONS.map((option) => ({ ...option }));
  protected readonly importOptions = [{ value: '', label: 'None' }, ...MOCK_MENTORSHIP_PROGRAMS.map((program) => ({ value: program.id, label: program.name }))];

  protected readonly draftTechnology = toSignal(this.draftTechForm.controls.technology.valueChanges, { initialValue: '' });

  private readonly formSnapshot = toSignal(toObservable(this.form).pipe(switchMap((group) => group.valueChanges.pipe(startWith(group.getRawValue())))), {
    initialValue: {} as Record<string, unknown>,
  });

  protected readonly nameLength = computed(() => String(this.formSnapshot()['name'] ?? this.form().controls['name']?.value ?? '').length);
  protected readonly descriptionLength = computed(() =>
    mentorshipDescriptionLength(String(this.formSnapshot()['description'] ?? this.form().controls['description']?.value ?? ''))
  );
  protected readonly technologies = computed(() => {
    const fromSnapshot = this.formSnapshot()['technologies'];
    if (Array.isArray(fromSnapshot)) return fromSnapshot as string[];
    return (this.form().controls['technologies']?.value as string[]) ?? [];
  });
  protected readonly logoFileName = computed(() => String(this.formSnapshot()['logoFileName'] ?? this.form().controls['logoFileName']?.value ?? ''));
  protected readonly logoPreviewUrl = computed(() => String(this.formSnapshot()['logoPreviewUrl'] ?? this.form().controls['logoPreviewUrl']?.value ?? ''));

  protected readonly availableTechnologies = computed(() => {
    const selected = new Set(this.technologies().map((item) => item.toLowerCase()));
    return MENTORSHIP_SKILL_OPTIONS.filter((tech) => !selected.has(tech.toLowerCase())).map((tech) => ({ label: tech, value: tech }));
  });

  protected onImportProgram(): void {
    const importId = (this.form().controls['importProgramId']?.value as string) ?? '';
    this.revokeLogoPreview();
    const fileEl = this.fileInput()?.nativeElement;
    if (fileEl) fileEl.value = '';
    this.form().patchValue(formFromImportedMentorshipProgram(importId));
    this.logoError.set('');
  }

  protected addTechnology(): void {
    const value = this.draftTechForm.controls.technology.value.trim();
    if (!value) return;
    const current = this.technologies();
    if (current.some((item) => item.toLowerCase() === value.toLowerCase())) return;
    this.form().controls['technologies'].setValue([...current, value]);
    this.draftTechForm.controls.technology.setValue('');
  }

  protected removeTechnology(tech: string): void {
    this.form().controls['technologies'].setValue(this.technologies().filter((item) => item !== tech));
  }

  protected onBrowseLogo(): void {
    this.fileInput()?.nativeElement.click();
  }

  protected onLogoChange(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    this.logoError.set('');
    if (!file) {
      this.revokeLogoPreview();
      this.form().patchValue({ logoFileName: '', logoPreviewUrl: '' });
      return;
    }
    if (file.size > MENTORSHIP_ENROLL_LOGO_MAX_BYTES) {
      this.logoError.set('File must be 2 MB or smaller.');
      input.value = '';
      this.revokeLogoPreview();
      this.form().patchValue({ logoFileName: '', logoPreviewUrl: '' });
      return;
    }
    this.revokeLogoPreview();
    this.form().patchValue({
      logoFileName: file.name,
      logoPreviewUrl: URL.createObjectURL(file),
    });
  }

  private revokeLogoPreview(): void {
    const url = this.form().controls['logoPreviewUrl']?.value as string;
    if (url?.startsWith('blob:')) {
      URL.revokeObjectURL(url);
    }
  }
}
