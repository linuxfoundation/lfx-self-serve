// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, DestroyRef, inject, input, output, Signal, signal } from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { ButtonComponent } from '@components/button/button.component';
import { InputTextComponent } from '@components/input-text/input-text.component';
import { MessageComponent } from '@components/message/message.component';
import { SelectButtonComponent } from '@components/select-button/select-button.component';
import { SelectComponent } from '@components/select/select.component';
import { TextareaComponent } from '@components/textarea/textarea.component';
import {
  PROJECT_APPLICATION_AGREEMENT_OPTIONS,
  PROJECT_APPLICATION_CANONICAL_KEYS,
  PROJECT_APPLICATION_CHAT_OPTIONS,
  PROJECT_APPLICATION_DESCRIPTION_MAX,
  PROJECT_APPLICATION_FIELD_LABELS,
  PROJECT_APPLICATION_FORMATION_LIST_MAX,
  PROJECT_APPLICATION_LICENSE_OPTIONS,
  PROJECT_APPLICATION_MISSION_MAX,
  PROJECT_APPLICATION_SPEC_OPTIONS,
  PROJECT_APPLICATION_TEXT_MAX,
  PROJECT_APPLICATION_TRADEMARK_OPTIONS,
} from '@lfx-one/shared/constants';
import type { ProjectApplicationAnswers } from '@lfx-one/shared/interfaces';
import { parseEmailList } from '@lfx-one/shared/utils';
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
  imports: [ButtonComponent, InputTextComponent, MessageComponent, ReactiveFormsModule, SelectButtonComponent, SelectComponent, TextareaComponent],
  templateUrl: './project-application-form.component.html',
})
export class ProjectApplicationFormComponent {
  // === Services ===
  private readonly destroyRef = inject(DestroyRef);

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

  // === Private Helpers ===
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
