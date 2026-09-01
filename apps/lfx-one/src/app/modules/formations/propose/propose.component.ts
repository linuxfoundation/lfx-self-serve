// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpErrorResponse } from '@angular/common/http';
import { Component, DestroyRef, inject, Signal, signal, WritableSignal } from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { ButtonComponent } from '@components/button/button.component';
import { CheckboxComponent } from '@components/checkbox/checkbox.component';
import { FileUploadComponent } from '@components/file-upload/file-upload.component';
import { InputTextComponent } from '@components/input-text/input-text.component';
import { OrganizationSearchComponent } from '@components/organization-search/organization-search.component';
import { SelectComponent } from '@components/select/select.component';
import { TextareaComponent } from '@components/textarea/textarea.component';
import {
  FORMATION_AGREEMENT_TYPE_OPTIONS,
  FORMATION_CHAT_PLATFORM_OPTIONS,
  FORMATION_DESCRIPTION_MAX_LENGTH,
  FORMATION_LICENSE_OPTIONS,
  FORMATION_MISSION_STATEMENT_MAX_LENGTH,
  FORMATION_TRADEMARK_STATUS_OPTIONS,
} from '@lfx-one/shared/constants';
import { FormationContact, FormationIntake, OrganizationResolveResult, Project } from '@lfx-one/shared/interfaces';
import { capCodePointEdit, codePointLength } from '@lfx-one/shared/utils';
import { httpsUrlValidator, maxCodePointsValidator, strictEmailValidator, trimmedRequired } from '@lfx-one/shared/validators';
import { FormationService } from '@services/formation.service';
import { ProjectService } from '@services/project.service';
import { MessageService } from 'primeng/api';
import { debounceTime, distinctUntilChanged, map, of, startWith, switchMap } from 'rxjs';

import { ProjectPickerComponent } from './components/project-picker/project-picker.component';
import { WhatsNextPanelComponent } from './components/whats-next-panel/whats-next-panel.component';

@Component({
  selector: 'lfx-propose',
  imports: [
    ReactiveFormsModule,
    ButtonComponent,
    InputTextComponent,
    TextareaComponent,
    SelectComponent,
    CheckboxComponent,
    FileUploadComponent,
    OrganizationSearchComponent,
    ProjectPickerComponent,
    WhatsNextPanelComponent,
  ],
  templateUrl: './propose.component.html',
  styleUrl: './propose.component.scss',
})
export class ProposeComponent {
  // Private injections
  private readonly destroyRef = inject(DestroyRef);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly formationService = inject(FormationService);
  private readonly projectService = inject(ProjectService);
  private readonly messageService = inject(MessageService);

  // Forms
  public readonly form: FormGroup = this.createFormGroup();
  public readonly newContactForm = new FormGroup({
    first_name: new FormControl('', { nonNullable: true, validators: [trimmedRequired()] }),
    last_name: new FormControl('', { nonNullable: true, validators: [trimmedRequired()] }),
    email: new FormControl('', { nonNullable: true, validators: [Validators.required, strictEmailValidator()] }),
  });
  /** Typed reference to the nested legal-contact group, so the template can bind `[formGroup]`/
   *  `[form]` directly instead of `$any(form.get('legal_contact'))` at every use site. */
  protected readonly legalContact = this.form.get('legal_contact') as FormGroup;

  // Option lists — spread into mutable arrays; lfx-select's `options` input is typed `any[]`.
  protected readonly trademarkStatusOptions = [...FORMATION_TRADEMARK_STATUS_OPTIONS];
  protected readonly licenseOptions = [...FORMATION_LICENSE_OPTIONS];
  protected readonly chatPlatformOptions = [...FORMATION_CHAT_PLATFORM_OPTIONS];
  protected readonly agreementTypeOptions = [...FORMATION_AGREEMENT_TYPE_OPTIONS];
  protected readonly missionStatementMaxLength = FORMATION_MISSION_STATEMENT_MAX_LENGTH;
  protected readonly descriptionMaxLength = FORMATION_DESCRIPTION_MAX_LENGTH;

  // Simple WritableSignals
  public submitting = signal(false);
  public additionalContacts = signal<FormationContact[]>([]);
  /** True only after a real "Add" click on `newContactForm` — distinct from that form's own
   *  `touched` state, which blurring through its fields (with no intent to add anyone) would
   *  also set, showing an "incomplete" error to a user who never asked to add a contact. */
  protected newContactAttempted = signal(false);
  /** Set once the `?parent=` prefill resolves, so `lfx-project-picker` can reflect the async pick — see `initialSelection` on that component. */
  protected prefilledParentProject = signal<Project | null>(null);
  protected logoFilename = signal<string | null>(null);
  protected missionStatementLength = signal(0);
  protected descriptionLength = signal(0);

  // Complex computed/toSignal
  protected readonly duplicateNameMatch: Signal<string | null> = this.initDuplicateNameMatch();

  public constructor() {
    this.prefillParentFromQueryParam();
    this.wireCodePointCap(this.form.get('mission_statement') as FormControl<string>, this.missionStatementMaxLength, this.missionStatementLength);
    this.wireCodePointCap(this.form.get('description') as FormControl<string>, this.descriptionMaxLength, this.descriptionLength);
  }

  public onSubmit(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }

    this.submitting.set(true);
    const intake = this.buildIntakePayload();

    this.formationService.createFormation(intake).subscribe({
      next: (formation) => {
        this.submitting.set(false);
        // Pass the created Formation via router state so the confirmation page renders it without
        // a second request — the fixture store is per-pod (multiple replicas), so a follow-up GET
        // can land on a pod that never saw this POST. State is the primary path; the confirmation
        // page's GET is a best-effort fallback for a direct or refreshed link only.
        this.router.navigate(['/propose/confirmation', formation.uid], { state: { formation } });
      },
      error: (error: HttpErrorResponse) => {
        this.submitting.set(false);
        this.messageService.add({
          severity: 'error',
          summary: 'Error',
          detail: error.error?.errors?.[0]?.message || 'Failed to submit the proposal. Please try again.',
        });
      },
    });
  }

  public addContact(): void {
    this.newContactAttempted.set(true);
    if (this.newContactForm.invalid) {
      this.newContactForm.markAllAsTouched();
      return;
    }
    const { first_name, last_name, email } = this.newContactForm.getRawValue();
    const trimmedEmail = email.trim();
    // Guards @for's `track contact.email` in the template — two entries with the same email would
    // otherwise produce a duplicate track key.
    const legalContactEmail = (this.legalContact.get('email')?.value ?? '').trim().toLowerCase();
    const isDuplicate =
      trimmedEmail.toLowerCase() === legalContactEmail ||
      this.additionalContacts().some((contact) => contact.email.toLowerCase() === trimmedEmail.toLowerCase());
    if (isDuplicate) {
      this.newContactForm.get('email')?.setErrors({ duplicateEmail: true });
      this.newContactForm.get('email')?.markAsTouched();
      return;
    }
    this.additionalContacts.update((contacts) => [...contacts, { first_name: first_name.trim(), last_name: last_name.trim(), email: trimmedEmail }]);
    this.newContactForm.reset({ first_name: '', last_name: '', email: '' });
    this.newContactAttempted.set(false);
  }

  public removeContact(index: number): void {
    this.additionalContacts.update((contacts) => contacts.filter((_, i) => i !== index));
  }

  protected onOrgResolved(result: OrganizationResolveResult): void {
    this.form.patchValue({ contributing_org_id: result.id || null });
  }

  protected onLogoSelect(event: { files?: File[] }): void {
    const file = event.files?.[0];
    this.logoFilename.set(file?.name ?? null);
  }

  /** Soft, non-blocking duplicate-name signal — debounced search against existing projects, distinct from the `project_name` control's own (required-only) validators so it never blocks submit. */
  private initDuplicateNameMatch(): Signal<string | null> {
    const nameControl = this.form.get('project_name') as FormControl<string>;
    return toSignal(
      nameControl.valueChanges.pipe(
        startWith(''),
        debounceTime(400),
        distinctUntilChanged(),
        switchMap((name) => {
          const trimmed = (name ?? '').trim();
          if (trimmed.length < 3) return of(null);
          // No catchError here, same resolution as ProjectPickerComponent.initResults:
          // ProjectService.searchProjects already logs and degrades internally, so a second
          // handler on the same call would be dead code per frontend-checklist.md §14.6.
          return this.projectService.searchProjects(trimmed).pipe(
            map((projects) => {
              const match = projects.find((project) => project.name.trim().toLowerCase() === trimmed.toLowerCase());
              return match ? match.name : null;
            })
          );
        })
      ),
      { initialValue: null }
    );
  }

  private createFormGroup(): FormGroup {
    return new FormGroup({
      parent_project_uid: new FormControl<string | null>(null),
      project_name: new FormControl('', [trimmedRequired()]),
      project_repository_url: new FormControl('', [httpsUrlValidator()]),
      trademark_status: new FormControl('', [Validators.required]),
      contributing_org_name: new FormControl('', [trimmedRequired()]),
      contributing_org_id: new FormControl<string | null>(null),
      contributing_org_website_url: new FormControl(''),
      legal_contact: new FormGroup({
        first_name: new FormControl('', [trimmedRequired()]),
        last_name: new FormControl('', [trimmedRequired()]),
        email: new FormControl('', [Validators.required, strictEmailValidator()]),
      }),
      license: new FormControl('', [Validators.required]),
      chat_platform: new FormControl('', [Validators.required]),
      mission_statement: new FormControl('', [trimmedRequired(), maxCodePointsValidator(FORMATION_MISSION_STATEMENT_MAX_LENGTH)]),
      agreement_type: new FormControl('', [Validators.required]),
      is_spec_project: new FormControl<boolean>(false, { nonNullable: true }),
      description: new FormControl('', [trimmedRequired(), maxCodePointsValidator(FORMATION_DESCRIPTION_MAX_LENGTH)]),
      website_url: new FormControl('', [httpsUrlValidator()]),
    });
  }

  private buildIntakePayload(): FormationIntake {
    const value = this.form.getRawValue();
    return {
      parent_project_uid: value.parent_project_uid || null,
      project_name: value.project_name.trim(),
      project_repository_url: value.project_repository_url?.trim() || null,
      project_logo_filename: this.logoFilename(),
      trademark_status: value.trademark_status,
      contributing_org_name: value.contributing_org_name.trim(),
      contributing_org_id: value.contributing_org_id || null,
      contributing_org_website_url: value.contributing_org_website_url?.trim() || null,
      legal_contact: value.legal_contact,
      additional_contacts: this.additionalContacts(),
      license: value.license,
      chat_platform: value.chat_platform,
      mission_statement: value.mission_statement.trim(),
      agreement_type: value.agreement_type,
      is_spec_project: value.is_spec_project,
      description: value.description.trim(),
      website_url: value.website_url?.trim() || null,
    };
  }

  /** Resolves a `?parent=<slug>` prefill from a foundation's "Add a project" entry point into the parent picker's uid control. */
  private prefillParentFromQueryParam(): void {
    const parentSlug = this.route.snapshot.queryParamMap.get('parent');
    if (!parentSlug) {
      return;
    }
    this.projectService
      .getProject(parentSlug, false)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((project) => {
        // Gated on `dirty`, not the control's value: a value-only check can't tell "never
        // touched" apart from "the user explicitly cleared it back to null" (ProjectPickerComponent
        // marks the control dirty on both select() and clear()) — a still-in-flight prefill must
        // not silently reinstate a parent the user just chose to remove.
        if (project && !this.form.get('parent_project_uid')?.dirty) {
          this.form.patchValue({ parent_project_uid: project.uid });
          this.prefilledParentProject.set(project);
        }
      });
  }

  /** Hard-caps a code-point-limited control (mission statement / description) and tracks its live length — same pattern as `profile-edit-drawer.component.ts`'s bio field. */
  private wireCodePointCap(control: FormControl<string>, max: number, lengthSignal: WritableSignal<number>): void {
    let lastValid = control.value ?? '';
    control.valueChanges.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((raw: string) => {
      const value = raw ?? '';
      if (codePointLength(value) > max) {
        const capped = capCodePointEdit(lastValid, value, max);
        control.setValue(capped, { emitEvent: false });
        lastValid = capped;
        lengthSignal.set(codePointLength(capped));
        return;
      }
      lastValid = value;
      lengthSignal.set(codePointLength(value));
    });
  }
}
