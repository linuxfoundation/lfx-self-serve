// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpErrorResponse } from '@angular/common/http';
import { Component, computed, DestroyRef, inject, Signal, signal, viewChild, WritableSignal } from '@angular/core';
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
  FORMATION_MAX_ADDITIONAL_CONTACTS,
  FORMATION_MISSION_STATEMENT_MAX_LENGTH,
  FORMATION_TRADEMARK_STATUS_OPTIONS,
} from '@lfx-one/shared/constants';
import { FormationContact, FormationIntake, OrganizationResolveResult, Project } from '@lfx-one/shared/interfaces';
import { capCodePointEdit, codePointLength } from '@lfx-one/shared/utils';
import { httpsUrlValidator, maxCodePointsValidator, strictEmailValidator, trimmedRequired } from '@lfx-one/shared/validators';
import { FormationService } from '@services/formation.service';
import { ProjectService } from '@services/project.service';
import { MessageService } from 'primeng/api';
import { debounceTime, distinctUntilChanged, map, of, startWith, switchMap, take } from 'rxjs';

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
  private readonly organizationSearch = viewChild(OrganizationSearchComponent);
  /** Backs additionalContacts' clientId — a monotonic counter, not crypto.randomUUID(), so
   *  server and client renders agree on the same id (hydration-safe) and the sequence
   *  (`contact-1`, `contact-2`, …) stays legible in a debugger without being random. */
  private nextContactClientId = 1;

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
  protected readonly maxAdditionalContacts = FORMATION_MAX_ADDITIONAL_CONTACTS;

  // Simple WritableSignals
  public submitting = signal(false);
  /** `clientId` (from `nextContactClientId`) is a view-only stable key (not part of the wire
   *  payload — buildIntakePayload strips it), so the @for track and each row's data-testid
   *  survive a removal instead of re-keying by array position, without putting the contact's
   *  email in a DOM attribute. */
  public additionalContacts = signal<(FormationContact & { clientId: string })[]>([]);
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
  /** Server rejects a POST with more than FORMATION_MAX_ADDITIONAL_CONTACTS — cap client-side too
   *  so the limit surfaces while adding contacts, not as a generic 400 toast on submit. */
  protected readonly additionalContactsAtLimit: Signal<boolean> = computed(() => this.additionalContacts().length >= FORMATION_MAX_ADDITIONAL_CONTACTS);

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

    // Manual-entry mode ("I want to create X") never reaches CDP on its own — onOrganizationResolved
    // only fires from resolveCurrentEntry() (called here) or the autocomplete-selection path, so a
    // manually-created org would otherwise submit with contributing_org_id: null and never actually
    // register. Only resolve here, not unconditionally on every submit: a search-mode pick has
    // already resolved via onOrgResolved, and resolveCurrentEntry() would just re-issue the same
    // CDP call for no gain.
    const orgSearch = this.organizationSearch();
    const resolve$ = orgSearch?.manualMode() ? orgSearch.resolveCurrentEntry() : of(null);
    resolve$.pipe(take(1), takeUntilDestroyed(this.destroyRef)).subscribe((result) => {
      // Belt-and-braces: the template's (onOrganizationResolved)="onOrgResolved($event)" binding
      // already patches this from the same emission (resolveCurrentEntry's emit happens
      // synchronously inside its own map(), upstream of this subscriber) — but that's an
      // implementation detail of organization-search.component.ts this file shouldn't have to
      // trust staying true. Patching again here is idempotent and costs nothing.
      if (result) {
        this.form.patchValue({ contributing_org_id: result.id || null });
      }
      this.submitFormation();
    });
  }

  public addContact(): void {
    // Checked before newContactAttempted: at the limit, the fields are still enabled (only the
    // Add button is disabled) so Enter in a field can still reach here — that must stay a silent
    // no-op explained by the limit's own role="status" message, not surface the unrelated
    // "incomplete contact" error for a user who never got that far.
    if (this.additionalContactsAtLimit()) {
      return;
    }
    this.newContactAttempted.set(true);
    if (this.newContactForm.invalid) {
      this.newContactForm.markAllAsTouched();
      return;
    }
    const { first_name, last_name, email } = this.newContactForm.getRawValue();
    const trimmedEmail = email.trim();
    // Prevents the same person appearing twice in "who else" (and matching the legal contact) —
    // not a track-key concern (the @for tracks contact.clientId, not email), just a UX guard.
    const legalContactEmail = (this.legalContact.get('email')?.value ?? '').trim().toLowerCase();
    const isDuplicate =
      trimmedEmail.toLowerCase() === legalContactEmail ||
      this.additionalContacts().some((contact) => contact.email.toLowerCase() === trimmedEmail.toLowerCase());
    if (isDuplicate) {
      this.newContactForm.get('email')?.setErrors({ duplicateEmail: true });
      this.newContactForm.get('email')?.markAsTouched();
      return;
    }
    // Computed before update(): an updater callback is expected to be a pure T => T, not a place
    // to run side effects like advancing a counter.
    const clientId = `contact-${this.nextContactClientId++}`;
    this.additionalContacts.update((contacts) => [...contacts, { clientId, first_name: first_name.trim(), last_name: last_name.trim(), email: trimmedEmail }]);
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
      // clientId is a view-only key (see additionalContacts' doc comment) — not part of the wire payload.
      additional_contacts: this.additionalContacts().map((contact) => ({
        first_name: contact.first_name,
        last_name: contact.last_name,
        email: contact.email,
      })),
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
    // getProject itself encodes slugOrUid into the request path — no need to pre-encode here.
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

  private submitFormation(): void {
    const intake = this.buildIntakePayload();

    this.formationService
      .createFormation(intake)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
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
          // ServiceValidationError.toResponse() is the only error shape carrying `errors[]`; every
          // other error class (e.g. the AuthorizationError blockDuringImpersonation raises on this
          // route) returns the unified { error, code, service } shape instead — fall through to
          // `.error` before the generic string, or a real server message (like the impersonation
          // block) would be swallowed and replaced with an unhelpful retry prompt.
          this.messageService.add({
            severity: 'error',
            summary: 'Error',
            detail: error.error?.errors?.[0]?.message || error.error?.error || 'Failed to submit the proposal. Please try again.',
          });
        },
      });
  }
}
