// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { afterNextRender, Component, computed, DestroyRef, ElementRef, inject, Injector, input, output, Signal, signal, viewChild } from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { ButtonComponent } from '@components/button/button.component';
import { InputTextComponent } from '@components/input-text/input-text.component';
import { MessageComponent } from '@components/message/message.component';
import { OrganizationSearchComponent } from '@components/organization-search/organization-search.component';
import { SelectButtonComponent } from '@components/select-button/select-button.component';
import { SelectComponent } from '@components/select/select.component';
import { TextareaComponent } from '@components/textarea/textarea.component';
import { UserSearchComponent } from '@components/user-search/user-search.component';
import {
  PROJECT_APPLICATION_AGREEMENT_OPTIONS,
  PROJECT_APPLICATION_CANONICAL_KEYS,
  PROJECT_APPLICATION_CHAT_OPTIONS,
  PROJECT_APPLICATION_DESCRIPTION_MAX,
  PROJECT_APPLICATION_FIELD_LABELS,
  PROJECT_APPLICATION_FORMATION_LIST_MAX,
  PROJECT_APPLICATION_LEGAL_BACK_TO_SEARCH_LABEL,
  PROJECT_APPLICATION_LEGAL_MANUAL_ENTRY_LABEL,
  PROJECT_APPLICATION_LEGAL_SEARCH_HINT,
  PROJECT_APPLICATION_LEGAL_SEARCH_PLACEHOLDER,
  PROJECT_APPLICATION_LICENSE_OPTIONS,
  PROJECT_APPLICATION_MISSION_MAX,
  PROJECT_APPLICATION_SPEC_OPTIONS,
  PROJECT_APPLICATION_TEXT_MAX,
  PROJECT_APPLICATION_TRADEMARK_OPTIONS,
} from '@lfx-one/shared/constants';
import type { ProjectApplicationAnswers, ProjectApplicationLegalContactMode } from '@lfx-one/shared/interfaces';
import { isEmailShape, parseEmailList } from '@lfx-one/shared/utils';
import { projectApplicationEmailListValidator, projectApplicationLegalEmailValidator, projectApplicationUrlValidator } from '@lfx-one/shared/validators';

/**
 * The "Propose a project" intake form (#3037), shared by the propose page (create) and the
 * application drawer (revise). Renders the design's section cards minus the parent project and logo
 * (out of scope). Emits the COMPLETE answer map: it starts from `initialAnswers` and overlays the
 * form's canonical keys, so a revise never drops an answer this form doesn't render (a newer form's
 * key, or the staff-set `parent_project_uid`). A canonical answer the user cleared is removed.
 */
@Component({
  selector: 'lfx-project-application-form',
  imports: [
    ButtonComponent,
    InputTextComponent,
    MessageComponent,
    OrganizationSearchComponent,
    ReactiveFormsModule,
    SelectButtonComponent,
    SelectComponent,
    TextareaComponent,
    UserSearchComponent,
  ],
  templateUrl: './project-application-form.component.html',
})
export class ProjectApplicationFormComponent {
  // === Services ===
  private readonly destroyRef = inject(DestroyRef);
  private readonly injector = inject(Injector);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly legalPicker = viewChild(UserSearchComponent);

  // === Inputs ===
  public readonly initialAnswers = input<ProjectApplicationAnswers | null>(null);
  public readonly submitting = input<boolean>(false);
  public readonly submitLabel = input<string>('Submit to formation team');
  public readonly submitIcon = input<string>('fa-light fa-paper-plane');
  public readonly errorMessage = input<string | null>(null);
  /** Wraps each section in a card (page) or renders flat sections (drawer). */
  public readonly layout = input<'page' | 'drawer'>('page');

  // === Outputs ===
  public readonly submitted = output<ProjectApplicationAnswers>();
  public readonly cancelled = output<void>();

  // === Template constants ===
  protected readonly labels = PROJECT_APPLICATION_FIELD_LABELS;
  protected readonly trademarkOptions = PROJECT_APPLICATION_TRADEMARK_OPTIONS;
  protected readonly chatOptions = PROJECT_APPLICATION_CHAT_OPTIONS;
  protected readonly agreementOptions = PROJECT_APPLICATION_AGREEMENT_OPTIONS;
  protected readonly specOptions = PROJECT_APPLICATION_SPEC_OPTIONS;
  protected readonly licenseOptions = PROJECT_APPLICATION_LICENSE_OPTIONS;
  protected readonly descriptionMax = PROJECT_APPLICATION_DESCRIPTION_MAX;
  protected readonly missionMax = PROJECT_APPLICATION_MISSION_MAX;
  protected readonly textMax = PROJECT_APPLICATION_TEXT_MAX;
  protected readonly formationListMax = PROJECT_APPLICATION_FORMATION_LIST_MAX;
  protected readonly legalSearchPlaceholder = PROJECT_APPLICATION_LEGAL_SEARCH_PLACEHOLDER;
  protected readonly legalSearchHint = PROJECT_APPLICATION_LEGAL_SEARCH_HINT;
  protected readonly legalManualEntryLabel = PROJECT_APPLICATION_LEGAL_MANUAL_ENTRY_LABEL;
  protected readonly legalBackToSearchLabel = PROJECT_APPLICATION_LEGAL_BACK_TO_SEARCH_LABEL;

  // === Forms ===
  public readonly form = new FormGroup({
    project_name: new FormControl<string>('', { nonNullable: true, validators: [Validators.required, Validators.maxLength(PROJECT_APPLICATION_TEXT_MAX)] }),
    project_repository_url: new FormControl<string>('', { nonNullable: true, validators: [Validators.required, projectApplicationUrlValidator(true)] }),
    project_website: new FormControl<string>('', { nonNullable: true, validators: [projectApplicationUrlValidator(false)] }),
    trademark_status: new FormControl<string | null>(null),
    contributing_organization: new FormControl<string>('', {
      nonNullable: true,
      validators: [Validators.required, Validators.maxLength(PROJECT_APPLICATION_TEXT_MAX)],
    }),
    legal_contact_email: new FormControl<string>('', { nonNullable: true, validators: [Validators.required, projectApplicationLegalEmailValidator()] }),
    formation_list: new FormControl<string>('', { nonNullable: true, validators: [projectApplicationEmailListValidator()] }),
    license: new FormControl<string | null>(null, { validators: [Validators.required] }),
    chat_platform: new FormControl<string | null>(null),
    mission_statement: new FormControl<string>('', {
      nonNullable: true,
      validators: [Validators.required, Validators.maxLength(PROJECT_APPLICATION_MISSION_MAX)],
    }),
    agreement_type: new FormControl<string | null>(null),
    is_spec_project: new FormControl<boolean | null>(null),
    description: new FormControl<string>('', {
      nonNullable: true,
      validators: [Validators.required, Validators.maxLength(PROJECT_APPLICATION_DESCRIPTION_MAX)],
    }),
  });

  // === Writable Signals ===
  private readonly formationListValue = signal('');
  private readonly descriptionValue = signal('');
  /** The legal contact's current address, which is also the label the directory search shows once one is picked. */
  protected readonly legalEmailValue = signal('');
  /** Directory search (create) or a plain email input (manual entry, and revise with a stored address). */
  protected readonly legalMode = signal<ProjectApplicationLegalContactMode>('search');
  /** Per-control "show the error" state, refreshed on every form event so the template reads a signal. */
  protected readonly invalid = signal<Record<string, boolean>>({});

  // === Computed Signals ===
  protected readonly formationListPreview = computed(() => parseEmailList(this.formationListValue()));
  protected readonly formationListInvalidText = computed(() => this.formationListPreview().invalid.join(', '));
  protected readonly descriptionLength: Signal<number> = computed(() => this.descriptionValue().length);
  protected readonly sectionClass = computed(() =>
    this.layout() === 'page' ? 'flex flex-col gap-4 rounded-xl border border-gray-200 bg-white p-6' : 'flex flex-col gap-4 border-b border-gray-100 pb-6'
  );

  // === Constructor ===
  public constructor() {
    this.form.controls.formation_list.valueChanges.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((value) => this.formationListValue.set(value ?? ''));
    this.form.controls.description.valueChanges.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((value) => this.descriptionValue.set(value ?? ''));
    this.form.controls.legal_contact_email.valueChanges.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((value) => this.legalEmailValue.set(value ?? ''));

    this.form.events.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(() => this.refreshInvalid());

    // Seed from the held answers whenever a different application is bound (drawer revise).
    toObservable(this.initialAnswers)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((answers) => this.patchFromAnswers(answers));
  }

  // === Protected Methods ===

  protected onSubmit(): void {
    if (this.submitting()) {
      return;
    }
    this.form.markAllAsTouched();
    this.refreshInvalid();
    if (this.form.invalid) {
      return;
    }
    this.submitted.emit(this.buildAnswers());
  }

  protected onCancel(): void {
    this.cancelled.emit();
  }

  /** A directory pick: the picker has written the address; touch it so a malformed directory address shows its error. */
  protected onLegalPicked(): void {
    this.form.controls.legal_contact_email.markAsTouched();
  }

  /** The picker's clear button nulls the control it binds; the control is non-nullable, so put the empty string back. */
  protected onLegalCleared(): void {
    this.form.controls.legal_contact_email.setValue('');
  }

  /**
   * "Enter an email address": swap the directory search for a plain input on the same control. A
   * picked address stays so it can be edited; text typed into the search that found nobody is
   * carried over when it looks like an address.
   */
  protected switchToManualLegal(): void {
    const typed = this.legalPicker()?.consumeDiscardedText() ?? null;
    this.legalMode.set('manual');
    if (typed && (isEmailShape(typed) || typed.includes('@'))) {
      this.form.controls.legal_contact_email.setValue(typed);
    }
    this.focusLegalInput();
  }

  /** Back to the directory. A hand-typed address names nobody the directory vouched for, so it is dropped. */
  protected backToLegalSearch(): void {
    this.form.controls.legal_contact_email.setValue('');
    this.form.controls.legal_contact_email.markAsUntouched();
    this.legalMode.set('search');
    this.focusLegalInput();
  }

  // === Private Helpers ===
  /** Keyboard users activate a link that removes itself; land them on the field that replaced it. */
  private focusLegalInput(): void {
    afterNextRender(() => this.host.nativeElement.querySelector<HTMLInputElement>('#pa-legal')?.focus(), { injector: this.injector });
  }

  private refreshInvalid(): void {
    const next: Record<string, boolean> = {};
    for (const [key, control] of Object.entries(this.form.controls)) {
      next[key] = control.invalid && (control.touched || control.dirty);
    }
    next['formation_list_over_max'] = this.form.controls.formation_list.hasError('emailListMax');
    this.invalid.set(next);
  }

  private patchFromAnswers(answers: ProjectApplicationAnswers | null): void {
    const source = answers ?? {};
    const text = (key: string): string => (typeof source[key] === 'string' ? (source[key] as string) : '');
    const optional = (key: string): string | null => (typeof source[key] === 'string' && source[key] ? (source[key] as string) : null);
    this.form.reset({
      project_name: text('project_name'),
      project_repository_url: text('project_repository_url'),
      project_website: text('project_website'),
      trademark_status: optional('trademark_status'),
      contributing_organization: text('contributing_organization'),
      legal_contact_email: text('legal_contact_email'),
      formation_list: Array.isArray(source.formation_list) ? source.formation_list.join('\n') : '',
      license: optional('license'),
      chat_platform: optional('chat_platform'),
      mission_statement: text('mission_statement'),
      agreement_type: optional('agreement_type'),
      is_spec_project: typeof source.is_spec_project === 'boolean' ? source.is_spec_project : null,
      description: text('description'),
    });
    this.formationListValue.set(this.form.controls.formation_list.value);
    this.legalEmailValue.set(this.form.controls.legal_contact_email.value);
    // A stored address is shown as plain text, which is always editable; the search box would seed it
    // only from its own inputs and drop the user into a picker with nothing to pick.
    this.legalMode.set(this.form.controls.legal_contact_email.value ? 'manual' : 'search');
    this.descriptionValue.set(this.form.controls.description.value);
  }

  /** Starts from the held answers so unknown keys survive, then overlays (or clears) every canonical key. */
  private buildAnswers(): ProjectApplicationAnswers {
    const answers: ProjectApplicationAnswers = { ...(this.initialAnswers() ?? {}) };
    const raw = this.form.getRawValue();

    for (const key of PROJECT_APPLICATION_CANONICAL_KEYS) {
      delete answers[key];
    }

    for (const key of PROJECT_APPLICATION_CANONICAL_KEYS) {
      if (key === 'formation_list') {
        const emails = parseEmailList(raw.formation_list).valid;
        if (emails.length > 0) {
          answers.formation_list = emails;
        }
        continue;
      }
      if (key === 'is_spec_project') {
        if (typeof raw.is_spec_project === 'boolean') {
          answers.is_spec_project = raw.is_spec_project;
        }
        continue;
      }
      const value = raw[key];
      const trimmed = typeof value === 'string' ? value.trim() : '';
      if (trimmed) {
        answers[key] = key === 'legal_contact_email' ? trimmed.toLowerCase() : trimmed;
      }
    }

    return answers;
  }
}
