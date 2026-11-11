// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { isPlatformBrowser } from '@angular/common';
import {
  afterNextRender,
  Component,
  computed,
  DestroyRef,
  ElementRef,
  inject,
  Injector,
  input,
  output,
  PLATFORM_ID,
  Signal,
  signal,
  viewChild,
} from '@angular/core';
import { takeUntilDestroyed, toObservable, toSignal } from '@angular/core/rxjs-interop';
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
  PROJECT_APPLICATION_DUPLICATE_NAME_MESSAGE,
  PROJECT_APPLICATION_FIELD_LABELS,
  PROJECT_APPLICATION_FORMATION_LIST_MAX,
  PROJECT_APPLICATION_LEGAL_BACK_TO_SEARCH_LABEL,
  PROJECT_APPLICATION_LEGAL_MANUAL_ENTRY_LABEL,
  PROJECT_APPLICATION_LEGAL_SEARCH_HINT,
  PROJECT_APPLICATION_LEGAL_SEARCH_PLACEHOLDER,
  PROJECT_APPLICATION_LICENSE_OPTIONS,
  PROJECT_APPLICATION_MISSION_MAX,
  PROJECT_APPLICATION_NAME_SEARCH_DEBOUNCE_MS,
  PROJECT_APPLICATION_NAME_SEARCH_MIN_CHARS,
  PROJECT_APPLICATION_SPEC_OPTIONS,
  PROJECT_APPLICATION_TEXT_MAX,
  PROJECT_APPLICATION_TRADEMARK_OPTIONS,
} from '@lfx-one/shared/constants';
import type { ProjectApplicationAnswers, ProjectApplicationFormMode, ProjectApplicationLegalContactMode } from '@lfx-one/shared/interfaces';
import { isEmailShape, parseEmailList } from '@lfx-one/shared/utils';
import { projectApplicationEmailListValidator, projectApplicationLegalEmailValidator, projectApplicationUrlValidator } from '@lfx-one/shared/validators';
import { ProjectService } from '@services/project.service';
import { UserService } from '@services/user.service';
import { concat, map, Observable, of, switchMap, timer } from 'rxjs';

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
  private readonly platformId = inject(PLATFORM_ID);
  private readonly userService = inject(UserService);
  private readonly projectService = inject(ProjectService);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly legalPicker = viewChild(UserSearchComponent);

  // === Inputs ===
  /** Set by the host: the propose page creates, the drawer revises. Only create prefills the organization. */
  public readonly mode = input.required<ProjectApplicationFormMode>();
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

  /** Text typed into the legal search and carried across a focus move within the field (see onLegalFocusOut). */
  private heldLegalText: string | null = null;

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
  /** The employer lookup runs at most once per form, however many times the bound answers change. */
  private prefillRequested = false;
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

  /** The existing project whose name the user's entry matches, if any. Advisory only — never gates submit. */
  protected readonly duplicateProjectName: Signal<string | null> = this.initDuplicateProjectName();
  protected readonly duplicateProjectMessage = computed(() => {
    const name = this.duplicateProjectName();
    // A function replacement, so `$&`-style sequences in a project name are inserted literally.
    return name ? PROJECT_APPLICATION_DUPLICATE_NAME_MESSAGE.replace('{name}', () => name) : null;
  });

  // === Constructor ===
  public constructor() {
    this.form.controls.formation_list.valueChanges.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((value) => this.formationListValue.set(value ?? ''));
    this.form.controls.description.valueChanges.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((value) => this.descriptionValue.set(value ?? ''));
    this.form.controls.legal_contact_email.valueChanges.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((value) => this.legalEmailValue.set(value ?? ''));

    this.form.events.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(() => this.refreshInvalid());

    // Seed from the held answers whenever a different application is bound (drawer revise).
    toObservable(this.initialAnswers)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((answers) => {
        this.patchFromAnswers(answers);
        if (this.mode() === 'create') {
          this.prefillOrganization();
        }
      });
  }

  // === Protected Methods ===

  protected onSubmit(): void {
    if (this.submitting()) {
      return;
    }
    // A click on Save blurs the search first, so this has normally run already; it covers a Save with no blur.
    this.resolveLegalSearchText();
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
    this.heldLegalText = null;
    this.form.controls.legal_contact_email.markAsTouched();
  }

  /** The picker's clear button nulls the control it binds; the control is non-nullable, so put the empty string back. */
  protected onLegalCleared(): void {
    this.heldLegalText = null;
    this.form.controls.legal_contact_email.setValue('');
  }

  /**
   * "Enter an email address": swap the directory search for a plain input on the same control. A
   * picked address stays so it can be edited; text typed into the search that found nobody is
   * carried over when it looks like an address.
   */
  protected switchToManualLegal(): void {
    const typed = this.takeLegalText();
    this.legalMode.set('manual');
    if (typed && this.looksLikeLegalEmail(typed)) {
      this.form.controls.legal_contact_email.setValue(typed);
    }
    this.focusLegalInput();
  }

  /**
   * Tabbing or clicking away from the directory search drops typed-but-unpicked text (GH-2694); apply the
   * one rule in {@link resolveLegalSearchText}. Focus moving within the field, or into the suggestion
   * list where a pick is about to follow, leaves the text alone. A null target is a click on
   * non-focusable space: nothing follows it, so it resolves like any other blur.
   */
  protected onLegalFocusOut(event: FocusEvent): void {
    const next = event.relatedTarget as Element | null;
    if (next && (event.currentTarget as Element).contains(next)) {
      // Moving within the field (e.g. Tab to "Enter an email address"): keep what was typed, since the
      // picker's own delayed search callback can run before the next step reads it.
      this.heldLegalText = this.legalPicker()?.consumeUncommittedText() ?? this.heldLegalText;
      return;
    }
    if (next?.closest('.p-overlay, .p-autocomplete-overlay')) {
      return;
    }
    this.resolveLegalSearchText();
  }

  /** Back to the directory. A hand-typed address names nobody the directory vouched for, so it is dropped. */
  protected backToLegalSearch(): void {
    this.heldLegalText = null;
    this.form.controls.legal_contact_email.setValue('');
    this.form.controls.legal_contact_email.markAsUntouched();
    this.legalMode.set('search');
    this.focusLegalInput();
  }

  // === Private Helpers ===
  /**
   * Best-effort duplicate check: once the user has stopped typing, look the name up among the projects
   * they can see and match it exactly, ignoring case and surrounding spaces. Only a name the user edited
   * is checked (a revise's stored name, loaded by a form reset, is left alone), and a failed search
   * shows nothing. The note clears as soon as the name changes, so none lingers while typing.
   */
  private initDuplicateProjectName(): Signal<string | null> {
    const control = this.form.controls.project_name;
    return toSignal(
      control.valueChanges.pipe(
        map((value) => (value ?? '').trim()),
        // Every change drops the previous note at once and cancels its timer and request; a note comes
        // back only if the user edited the name and, once typing settles, it matches a project. A pristine
        // control (a stored or newly bound name loaded by a form reset) clears the note and asks nothing.
        // The search itself never errors: ProjectService.searchProjects turns a failure into no results.
        switchMap((name): Observable<string | null> => {
          if (!control.dirty || name.length < PROJECT_APPLICATION_NAME_SEARCH_MIN_CHARS) {
            return of(null);
          }
          return concat(
            of(null),
            timer(PROJECT_APPLICATION_NAME_SEARCH_DEBOUNCE_MS).pipe(
              switchMap(() => this.projectService.searchProjects(name)),
              map((projects) => projects.find((project) => project.name?.trim().toLowerCase() === name.toLowerCase())?.name ?? null)
            )
          );
        })
      ),
      { initialValue: null }
    );
  }

  /**
   * Create mode only: fill the organization with the submitter's current employer. Once, browser-only,
   * and only if the field is still empty when the answer arrives — a name the user typed meanwhile
   * wins. A failed or empty lookup leaves it blank; it never runs on revise.
   */
  private prefillOrganization(): void {
    if (this.prefillRequested || !isPlatformBrowser(this.platformId)) {
      return;
    }
    this.prefillRequested = true;
    this.userService
      .getCurrentEmployerName()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((name) => {
        const organization = this.form.controls.contributing_organization;
        if (!name || this.mode() !== 'create' || organization.value.trim()) {
          return;
        }
        organization.setValue(name.slice(0, PROJECT_APPLICATION_TEXT_MAX));
      });
  }

  /**
   * The one rule for text left in the legal search box, applied on blur and on Save. A picked contact never
   * survives an edit of that text:
   * - email-like text (valid or not) moves to the plain input holding it, marked touched, so the control's
   *   own validator decides whether Save goes ahead;
   * - anything else (a name) clears the control, so Save is blocked by the required error.
   * No leftover text means nothing was edited and any picked contact stands.
   */
  private resolveLegalSearchText(): void {
    if (this.legalMode() !== 'search') {
      return;
    }
    const typed = this.takeLegalText();
    if (typed === null) {
      return;
    }
    const control = this.form.controls.legal_contact_email;
    control.markAsTouched();
    if (typed !== '' && this.looksLikeLegalEmail(typed)) {
      control.setValue(typed);
      this.legalMode.set('manual');
      return;
    }
    control.setValue('');
  }

  /**
   * What the user left in the legal search and never picked: the box's live text first (Enter on the
   * field, or a Save that keeps focus), else text held from a move within the field. `''` means the box
   * was emptied, which is an edit too. `null` means nothing was edited.
   */
  private takeLegalText(): string | null {
    const fresh = this.legalPicker()?.consumeUncommittedText() ?? null;
    const typed = fresh ?? this.heldLegalText;
    this.heldLegalText = null;
    return typed;
  }

  private looksLikeLegalEmail(text: string): boolean {
    return isEmailShape(text) || text.includes('@') || projectApplicationLegalEmailValidator()(new FormControl(text)) === null;
  }

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
